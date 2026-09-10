(function dashboardModule(global) {
  function escapeHtml(value) {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function preferenceControl(device, key, preference, messages) {
    const labels = {
      represented: messages.preferenceRepresented,
      audio: messages.preferenceAudio,
      snapshotMode: messages.preferenceSnapshotMode,
    };
    const represented = preference.represented;
    const dependent = key === 'represented' ? '' : ` data-requires-representation${represented ? '' : ' hidden'}`;
    if (key === 'snapshotMode') {
      const descriptions = {
        Cloud: messages.snapshotModeCloudDescription,
        Live: messages.snapshotModeLiveDescription,
        Refresh: messages.snapshotModeRefreshDescription,
      };
      return `<div class="snapshot-setting" data-setting${dependent}><span class="setting-label">${escapeHtml(labels[key])}</span><div class="snapshot-segments" role="radiogroup" aria-label="${escapeHtml(labels[key])}">${['Cloud', 'Live', 'Refresh'].map((mode) => `<label class="snapshot-segment"><input type="radio" name="snapshot-${escapeHtml(device.serial)}" value="${mode}" data-preference="${key}" data-serial="${escapeHtml(device.serial)}" data-original="${escapeHtml(preference.snapshotMode)}" data-description="${escapeHtml(descriptions[mode])}"${preference.snapshotMode === mode ? ' checked' : ''}><span>${mode}</span></label>`).join('')}</div><p class="snapshot-description" data-snapshot-description>${escapeHtml(descriptions[preference.snapshotMode])}</p></div>`;
    }
    return `<label class="toggle" data-setting${dependent}><input type="checkbox" data-preference="${key}" data-serial="${escapeHtml(device.serial)}" data-original="${String(preference[key])}"${preference[key] ? ' checked' : ''}><span>${escapeHtml(labels[key])}</span></label>`;
  }

  function markPendingPreference(control, key, value) {
    if (!control?.classList || control.dataset.original === undefined) return;
    const current = key === 'snapshotMode' ? String(value) : String(Boolean(value));
    const setting = control.closest('[data-setting]');
    const changed = current !== control.dataset.original;
    if (key === 'snapshotMode') {
      setting.querySelectorAll('[data-preference="snapshotMode"]').forEach((entry) => {
        entry.classList.remove('preference-control-changed');
      });
    }
    control.classList.toggle('preference-control-changed', changed);
    setting?.classList.toggle('preference-changed', changed);
    const tile = control.closest('.device-tile');
    tile?.classList.toggle('device-tile-changed', Boolean(tile.querySelector('.preference-control-changed')));
  }

  /**
   * The eight battery icons the shipped set draws, from empty to full.
   *
   * Ordered, because the level picks one by its position: eight steps of twelve and a half percent each.
   */
  const BATTERY_STEPS = [
    'battery_0',
    'battery_1',
    'battery_2',
    'battery_3',
    'battery_4',
    'battery_5',
    'battery_6',
    'battery_full',
  ];

  /**
   * The battery badge a device gets, where it reports a level, and nothing where it does not.
   *
   * The icon carries the level and the exact percentage goes to the label: a tile is read at a glance, and a
   * number on every tile would be read deliberately or not at all. A device on mains power reports no level, and
   * neither does one nothing is observing, so both are left without a badge rather than shown an empty one.
   */
  function batteryBadge(device, messages) {
    if (typeof device.battery !== 'number') {
      return undefined;
    }
    const step = Math.floor(device.battery / (100 / BATTERY_STEPS.length));
    const icon = BATTERY_STEPS[Math.min(BATTERY_STEPS.length - 1, Math.max(0, step))];
    const label = (messages.deviceBattery ?? '').replace('{level}', String(Math.round(device.battery)));
    return label ? { icon, label, variant: 'battery' } : undefined;
  }

  /**
   * The one thing worth saying about a device in place of its model, or nothing.
   *
   * Ordered by what displaces what: a device nothing can reach says nothing else useful about itself, a camera
   * reports itself switched off only while it is reachable, a device withheld from HomeKit is the user's own
   * decision rather than a fault, and a camera that reports itself on says so last, because that is the state a
   * user assumes until one of the others contradicts it. A device that reports none of them keeps its model,
   * which is what identifies it when there is nothing to report, and so does one whose catalog carries no
   * wording for the status it has.
   */
  function deviceStatus(device, rank, messages) {
    const [key, tone] =
      device.availability === 'unavailable'
        ? ['deviceStatusUnreachable', 'fault']
        : device.enabled === false
          ? ['deviceStatusSwitchedOff', 'alert']
          : rank === 1
            ? ['deviceStatusHidden', 'quiet']
            : device.enabled === true
              ? ['deviceStatusOnline', 'live']
              : [];
    const label = key ? messages[key] : undefined;
    return label ? { label, tone } : undefined;
  }

  function renderDevices(devices, config, messages, deviceGroups) {
    const preferences = config.entityPreferences ?? {};
    deviceGroups.innerHTML = ['security', 'life', 'clean']
      .map((category) => {
        const categoryDevices = devices
          .filter((device) => device.category === category)
          .map((device) => ({
            device,
            rank: device.diagnosticOnly
              ? 2
              : preferences[device.serial]?.represented === false
                ? 1
                : 0,
          }))
          .sort(
            (left, right) =>
              left.rank - right.rank ||
              left.device.deviceClass.localeCompare(right.device.deviceClass) ||
              left.device.modelName.localeCompare(right.device.modelName) ||
              left.device.name.localeCompare(right.device.name),
          );
        if (categoryDevices.length === 0) return '';
        const tiles = categoryDevices
          .map(({ device, rank }) => {
            const badges = [
              device.diagnosticOnly ? { icon: 'troubleshoot', label: messages.diagnosticOnly } : undefined,
              batteryBadge(device, messages),
            ].filter(Boolean);
            const artwork = device.artwork
              ? `<img src="${escapeHtml(device.artwork)}" alt="" loading="lazy" data-device-artwork>`
              : '';
            const status = deviceStatus(device, rank, messages);
            const secondLine = status
              ? `<p class="device-status device-status-${status.tone}"><span class="device-status-dot" aria-hidden="true"></span><span class="device-status-label">${escapeHtml(status.label)}</span></p>`
              : `<p>${escapeHtml(device.modelName)}</p>`;
            const tile = `
              <div class="device-art" aria-hidden="true"><img class="device-class-icon" src="assets/icons/inventory.svg" alt=""><span>${escapeHtml(device.deviceClass)}</span>${artwork}</div>
              <div class="device-copy"><h3>${escapeHtml(device.name)}</h3>${secondLine}</div>
              <div class="device-badges">${badges.map(({ icon, label, variant }) => `<span class="device-badge device-badge-${variant ?? icon}" role="img" tabindex="0" aria-label="${escapeHtml(label)}" data-tooltip="${escapeHtml(label)}"><img src="assets/icons/${icon}.svg" alt=""></span>`).join('')}</div>`;
            const disabledClass = rank === 1 ? ' device-tile-disabled' : '';
            return `<article class="device-tile${disabledClass}" data-category="${category}" data-rank="${rank}" data-serial="${escapeHtml(device.serial)}" data-device-class="${escapeHtml(device.deviceClass)}"><button class="device-summary device-open-control" type="button" aria-haspopup="dialog">${tile}</button></article>`;
          })
          .join('');
        const categoryKey = `category${category[0].toUpperCase()}${category.slice(1)}`;
        return `<section class="device-group"><h2>${escapeHtml(messages[categoryKey])}</h2><div class="device-grid">${tiles}</div></section>`;
      })
      .join('');
  }

  /**
   * Shows the notice that this page is answering from a superseded build, and only where one is proven.
   *
   * The version is named because it is the one fact a reader cannot get anywhere else on the page. The action is
   * offered only where ending the older build would replace it; elsewhere the copy asks for the restart instead,
   * so nobody is given a button that cannot work.
   */
  /*
   * What each adapter becomes in HomeKit, in words. Keyed by the adapter the projection names, because the name a
   * user reads belongs here rather than in the code that decides which adapters apply.
   */
  const HOMEKIT_SERVICE_LABELS = {
    'arming.security-system': 'serviceSecuritySystem',
    'camera.streaming': 'serviceCamera',
    'camera.controls': 'serviceCameraSwitches',
    'contact.sensor': 'serviceContact',
    'doorbell.press': 'serviceDoorbell',
    'lock.mechanism': 'serviceLock',
    'motion.sensor': 'serviceMotion',
    'siren.test': 'serviceSiren',
    'smart-light.lightbulb': 'serviceLight',
  };

  /**
   * Names what the device becomes in HomeKit, above the switch that decides whether it becomes it at all.
   *
   * "Represent in HomeKit" says that something appears and never what, which is least obvious exactly where it
   * matters most: a station appears as an alarm, and a camera as several things at once. An adapter this build has
   * no words for is left out rather than shown as its key, and a device that names none — an answer from a build
   * that predates this line — costs its tile the line rather than the whole dashboard.
   */
  function representationLine(device, messages) {
    const named = (device.representation ?? []).map((key) => messages[HOMEKIT_SERVICE_LABELS[key]]).filter(Boolean);
    if (named.length === 0) return '';
    return `<p class="preference-representation">${escapeHtml(`${messages.representationLabel} ${named.join(', ')}`)}</p>`;
  }

  function renderUpdatePending(result, messages, elements) {
    if (!elements.updatePending) {
      return;
    }
    const pending = result.runningVersion !== undefined;
    elements.updatePending.hidden = !pending;
    if (!pending) {
      return;
    }
    elements.updatePendingSummary.textContent = result.restartable
      ? messages.updatePendingSummary
      : messages.updatePendingManual;
    elements.updatePendingVersion.textContent = `${messages.updatePendingVersionLabel} ${result.runningVersion}`;
    elements.updateRestart.hidden = !result.restartable;
  }

  function render(result, config, messages, elements) {
    const suffix = result.state
      .split('-')
      .map((part) => part[0].toUpperCase() + part.slice(1))
      .join('');
    elements.title.textContent = messages[`dashboard${suffix}Title`] ?? messages.dashboardIncompleteTitle;
    elements.badge.textContent = messages[`dashboard${suffix}Badge`] ?? messages.dashboardIncompleteBadge;
    elements.summary.textContent = messages[`dashboard${suffix}Summary`] ?? messages.dashboardIncompleteSummary;
    elements.dashboard.dataset.state = result.state;
    elements.dashboard.hidden = false;
    elements.masthead.hidden = true;
    renderUpdatePending(result, messages, elements);
    renderDevices(result.devices, config, messages, elements.groups);
    elements.setup.hidden = true;
    elements.authenticate.hidden = false;
    if (result.devices.length > 0) {
      elements.pageTitle.textContent = messages.dashboardPageTitle;
    } else if (result.state === 'authentication-required') {
      elements.setup.hidden = false;
    }
  }

  function bindPreferences(elements, getConfig, saveConfig, getMessages, openDevice) {
    elements.groups.addEventListener('click', (event) => {
      const opener = event.target.closest?.('.device-open-control');
      if (!opener) return;
      openDevice?.(opener.closest('.device-tile').dataset.serial, opener);
    });
    elements.groups.addEventListener(
      'load',
      (event) => {
        if (event.target?.dataset?.deviceArtwork !== undefined) {
          event.target.parentElement.dataset.artworkLoaded = '';
        }
      },
      true,
    );
    elements.groups.addEventListener(
      'error',
      (event) => {
        if (event.target?.dataset?.deviceArtwork !== undefined) event.target.hidden = true;
      },
      true,
    );
    (elements.deviceSettingsControls ?? elements.groups).addEventListener('change', async (event) => {
      const control = event.target;
      const serial = control?.dataset?.serial;
      const key = control?.dataset?.preference;
      const existing = getConfig();
      if (!existing || !serial || !key) return;
      const defaults = { represented: true, audio: true, snapshotMode: 'Refresh' };
      const value = key === 'snapshotMode' ? control.value : control.checked;
      markPendingPreference(control, key, value);
      if (key === 'snapshotMode') {
        control.closest('.snapshot-setting')?.querySelector('[data-snapshot-description]').replaceChildren(
          control.dataset.description,
        );
      }
      const entityPreferences = { ...(existing.entityPreferences ?? {}) };
      const preference = { ...(entityPreferences[serial] ?? {}) };
      if (value === defaults[key]) delete preference[key];
      else preference[key] = value;
      if (Object.keys(preference).length === 0) delete entityPreferences[serial];
      else entityPreferences[serial] = preference;
      try {
        await saveConfig({ ...existing, entityPreferences });
        if (key === 'represented') {
          // The control and the tile it speaks for are in two different places now, so the tile is found by serial.
          const tile = [...elements.groups.querySelectorAll('.device-tile')].find(
            (candidate) => candidate.dataset.serial === serial,
          );
          tile?.classList.toggle('device-tile-disabled', !value);
          control
            .closest('.preference-grid')
            ?.querySelectorAll('[data-requires-representation]')
            .forEach((setting) => {
              setting.hidden = !value;
            });
        }
      } catch {
        elements.summary.textContent = getMessages().preferenceSaveFailed;
      }
    });
  }

  /**
   * Fills the settings page for one device, which is where its controls live rather than on the tile itself.
   *
   * The tile is a summary and a fixed square; a device's settings are neither, and grew past it. A device that
   * nothing represents gets the explanation instead of controls, because there is nothing for it to obey.
   */
  function renderDeviceSettings(device, config, messages, elements) {
    const preferences = config.entityPreferences ?? {};
    elements.deviceSettingsTitle.textContent = device.name;
    elements.deviceSettingsEyebrow.textContent = device.modelName;
    if (device.diagnosticOnly) {
      elements.deviceSettingsControls.innerHTML = `<div class="diagnostic-panel"><img src="assets/icons/troubleshoot.svg" alt=""><strong>${escapeHtml(messages.diagnosticOnly)}</strong><p>${escapeHtml(messages.diagnosticDescription)}</p></div>`;
      return;
    }
    const preference = {
      represented: preferences[device.serial]?.represented ?? true,
      audio: preferences[device.serial]?.audio ?? true,
      snapshotMode: preferences[device.serial]?.snapshotMode ?? 'Refresh',
    };
    const controls = device.preferences
      .map((key) => preferenceControl(device, key, preference, messages))
      .join('');
    elements.deviceSettingsControls.innerHTML = `${representationLine(device, messages)}${controls}`;
  }

  /**
   * Puts each camera's own last image on its tile, keeping the packaged product photograph where there is none.
   *
   * One request per tile and one at a time: an image is up to ten megabytes and the answers are base64, so
   * asking for every camera at once would hold the whole grid's worth in the page before any of it is shown.
   * The product photograph is only replaced once the browser has decoded the answer, so a truncated or
   * undecodable image leaves the tile exactly as it was rather than empty.
   */
  async function applyDeviceImages(elements, requestImage) {
    for (const tile of elements.groups.querySelectorAll('.device-tile[data-device-class="camera"][data-serial]')) {
      const art = tile.querySelector('.device-art');
      if (!art) continue;
      let answer;
      try {
        answer = await requestImage(tile.dataset.serial);
      } catch {
        continue;
      }
      if (!answer?.image) continue;
      let image = art.querySelector('img[data-device-artwork]');
      if (!image) {
        image = document.createElement('img');
        image.alt = '';
        image.setAttribute('data-device-artwork', '');
        art.appendChild(image);
      }
      const packaged = image.getAttribute('src');
      image.addEventListener(
        'load',
        () => {
          tile.setAttribute('data-artwork-scene', '');
        },
        { once: true },
      );
      image.addEventListener(
        'error',
        () => {
          tile.removeAttribute('data-artwork-scene');
          image.hidden = !packaged;
          if (packaged) image.src = packaged;
        },
        { once: true },
      );
      image.src = `data:image/jpeg;base64,${answer.image}`;
    }
  }

  global.HomebridgeEufyDashboard = {
    applyDeviceImages,
    bindPreferences,
    render,
    renderDeviceSettings,
    renderUpdatePending,
  };
})(window);
