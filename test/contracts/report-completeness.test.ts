import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const source = /script: \|\n([\s\S]*)$/
  .exec(readFileSync(new URL('../../.github/workflows/report-completeness.yml', import.meta.url), 'utf8'))![1]!
  .split('\n')
  .map((line) => line.replace(/^ {12}/, ''))
  .join('\n');
const assess = new Function('context', 'github', 'core', `return (async () => {${source}})()`);

const ARCHIVE = 'https://github.com/user-attachments/files/1/x.eufysupport.gz';
const FLOW_LINE = '- **Diagnostics profile**: live-media (now)';

const bugReport = ({ flow, version }: { flow: boolean; version: string }) =>
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

interface Report {
  action: string;
  flow?: boolean;
  archive?: boolean;
  version?: string;
  bugForm?: boolean;
  closed?: boolean;
  upload?: string;
  by?: string;
  held?: boolean;
  note?: string;
}

async function outcomeOf({
  action,
  flow = false,
  archive = false,
  version = '5.0.0-beta.11',
  bugForm = true,
  closed = false,
  upload,
  by = 'reporter',
  held = false,
  note,
}: Report): Promise<string> {
  const acted: string[] = [];
  const issue = {
    number: 1,
    body: bugForm ? bugReport({ flow, version }) : '### Model\n\nT8000P0000000000',
    labels: [{ name: held ? 'needs-info' : 'needs-triage' }],
    state: closed ? 'closed' : 'open',
    user: { login: 'reporter' },
  };
  const comments: { id: number; body: string; author_association?: string }[] = archive
    ? [{ id: 9, body: ARCHIVE, author_association: 'NONE' }]
    : [];
  if (closed) {
    comments.unshift({
      id: 8,
      body: '<!-- report-completeness -->\n**This report was not opened from the plugin, so it is closed as it stands.**',
    });
  }
  const comment = (upload || note) && {
    id: 10,
    body: note ?? `https://github.com/user-attachments/files/2/${upload}`,
    user: { login: by },
  };
  if (comment) {
    comments.push({ ...comment, author_association: 'NONE' });
  }
  const github = {
    paginate: async () => comments,
    rest: {
      issues: {
        listComments: {},
        createComment: async ({ body }: { body: string }) =>
          acted.push(
            /closed as it stands/.test(body)
              ? 'redirected'
              : /name changed/.test(body)
                ? 'told the name changed'
                : /change the password/.test(body)
                  ? 'warned'
                  : 'asked',
          ),
        deleteComment: async ({ comment_id }: { comment_id: number }) => {
          comments.splice(
            comments.findIndex(({ id }) => id === comment_id),
            1,
          );
          acted.push('deleted a comment');
        },
        update: async (fields: { state?: string; state_reason?: string }) =>
          acted.push(
            fields.state === 'open'
              ? 'reopened'
              : fields.state
                ? `closed as ${fields.state_reason}`
                : 'edited the body',
          ),
        addLabels: async ({ labels }: { labels: string[] }) => acted.push(`labelled ${labels.join()}`),
        removeLabel: async ({ name }: { name: string }) => acted.push(`unlabelled ${name}`),
      },
    },
  };

  await assess({ payload: { issue, action, comment }, repo: { owner: 'o', repo: 'r' }, eventName: 'issues' }, github, {
    info() {},
    warning() {},
  });
  return acted.join(', ') || 'nothing';
}

const CASES: [string, Report, string][] = [
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
  [
    'a diagnostics file with a changed name is removed without the password warning',
    { action: 'created', flow: true, archive: true, upload: 'homebridge-eufy-support-1.eufysupport.1.gz' },
    'deleted a comment, told the name changed',
  ],
  [
    'any other file is removed with the password warning',
    { action: 'created', flow: true, archive: true, upload: 'homebridge-backup.tar.gz' },
    'deleted a comment, warned',
  ],
  [
    'a report closed outside the flow reopens when its reporter attaches the archive',
    { action: 'created', closed: true, upload: 'homebridge-eufy-support-1.eufysupport.gz' },
    'reopened',
  ],
  [
    'an archive from anyone else does not reopen it',
    { action: 'created', closed: true, upload: 'homebridge-eufy-support-1.eufysupport.gz', by: 'stranger' },
    'nothing',
  ],
  [
    'a renamed archive does not reopen it',
    { action: 'created', closed: true, upload: 'homebridge-eufy-support-1.eufysupport.zip' },
    'deleted a comment, told the name changed',
  ],
  [
    'an archive answering the ask puts the report back to triage',
    { action: 'created', flow: true, held: true, upload: 'homebridge-eufy-support-1.eufysupport.gz' },
    'unlabelled needs-info, labelled needs-triage',
  ],
  [
    'a reply on a report that already holds an older archive leaves the ask standing',
    { action: 'created', flow: true, archive: true, held: true, note: 'Please run this and paste the line.' },
    'nothing',
  ],
];

/**
 * The workflow's own script, read out of `report-completeness.yml` and driven against a fake GitHub, decides
 * whether a report is answered, held, closed or reopened, on every report whose outcome is a decision rather
 * than a default.
 */
describe('report completeness workflow', () => {
  it.each(CASES)('%s', async (_name, report, expected) => {
    expect(await outcomeOf(report)).toBe(expected);
  });
});
