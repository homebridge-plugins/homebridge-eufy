#!/usr/bin/env node
// The cases `report-completeness.yml` is judged on, run against the workflow's own script.
//
// The script decides whether a report is answered, held or closed, and a mistake in it acts on a stranger's
// issue where nothing rehearses it. So the script is read out of the workflow and driven here against a fake
// GitHub, and the seven reports below are the ones whose outcome is a decision rather than a default.
//
// Run it after any edit to the workflow: `node scripts/report-completeness-cases.mjs`

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const workflow = join(dirname(fileURLToPath(import.meta.url)), '..', '.github', 'workflows', 'report-completeness.yml');
const source = /script: \|\n([\s\S]*)$/
  .exec(readFileSync(workflow, 'utf8'))[1]
  .split('\n')
  .map((line) => line.replace(/^ {12}/, ''))
  .join('\n');
const assess = new Function('context', 'github', 'core', `return (async () => {${source}})()`);

const ARCHIVE = 'https://github.com/user-attachments/files/1/x.eufysupport.gz';
const FLOW_LINE = '- **Diagnostics profile**: live-media (now)';

const bugReport = ({ flow, version }) =>
  [
    '### Environment',
    '',
    '```markdown',
    `- **Plugin Version**: ${version}`,
    '- **Homebridge Version**: 2.4.0',
    ...(flow ? [FLOW_LINE] : []),
    '```',
    '',
    '### Diagnostics Archive',
    '',
    'N/A',
    '',
    '### What happened?',
    '',
    'it broke',
  ].join('\n');

/** What the workflow did, in the vocabulary the cases are stated in rather than as REST calls. */
async function outcomeOf({ action, flow = false, archive = false, version = '5.0.0-beta.11', bugForm = true }) {
  const acted = [];
  const issue = {
    number: 1,
    body: bugForm ? bugReport({ flow, version }) : '### Model\n\nT8000P0000000000',
    labels: [{ name: 'needs-triage' }],
  };
  const comments = archive ? [{ id: 9, body: ARCHIVE, author_association: 'NONE' }] : [];
  const github = {
    paginate: async () => comments,
    rest: {
      issues: {
        listComments: {},
        createComment: async ({ body }) => acted.push(/closed as it stands/.test(body) ? 'redirected' : 'asked'),
        deleteComment: async () => acted.push('deleted a comment'),
        update: async (fields) => acted.push(fields.state ? `closed as ${fields.state_reason}` : 'edited the body'),
        addLabels: async ({ labels }) => acted.push(`labelled ${labels.join()}`),
        removeLabel: async ({ name }) => acted.push(`unlabelled ${name}`),
      },
    },
  };

  await assess({ payload: { issue, action }, repo: { owner: 'o', repo: 'r' }, eventName: 'issues' }, github, {
    info() {},
    warning() {},
  });
  return acted.join(', ') || 'nothing';
}

const CASES = [
  [
    'a report opened outside the flow is redirected and closed',
    { action: 'opened' },
    'redirected, closed as not_planned',
  ],
  [
    'a V4 report opened outside the flow is told both things, once',
    { action: 'opened', version: '4.7.2' },
    'redirected, closed as not_planned',
  ],
  [
    'a report from the flow with no archive is held on its reporter',
    { action: 'opened', flow: true },
    'asked, labelled needs-info, unlabelled needs-triage',
  ],
  ['an archive makes the path it arrived by irrelevant', { action: 'opened', archive: true }, 'nothing'],
  [
    'an edit to a report filed before the rule closes nothing',
    { action: 'edited' },
    'asked, labelled needs-info, unlabelled needs-triage',
  ],
  [
    'a comment on a report filed before the rule closes nothing',
    { action: 'created' },
    'asked, labelled needs-info, unlabelled needs-triage',
  ],
  ['a request that was never asked for an archive is left alone', { action: 'opened', bugForm: false }, 'nothing'],
];

for (const [name, report, expected] of CASES) {
  assert.equal(await outcomeOf(report), expected, name);
  console.log(`ok  ${name}`);
}
console.log(`${CASES.length} cases`);
