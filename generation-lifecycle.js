import { cleanGenerationHistory } from './context-clean.js';
import { createPresetGate } from './preset.js';

export function createGenerationLifecycle({ context, scope, flags, ready, memory, disableMemory, report, refresh }) {
  const gate = createPresetGate();
  let source, listeners = [];
  let revision = 0, destroyed = false, livePreset = false;

  function reset() {
    revision++;
    livePreset = false;
    gate.restore();
    memory()?.invalidateGeneration?.();
  }

  function unbind() {
    for (const remove of listeners) remove();
    listeners = [];
    source = undefined;
  }

  function bind() {
    if (destroyed) return;
    const host = context();
    if (source === host.eventSource) return;
    if (source) reset();
    unbind();
    const types = host.eventTypes || host.event_types;
    if (!host.eventSource?.on || !types) return;
    source = host.eventSource;
    const events = source;
    function on(key, listener) {
      const name = types[key];
      if (!name) return;
      events.on(name, listener);
      listeners.push(() => {
        if (events.removeListener) events.removeListener(name, listener);
        else events.off?.(name, listener);
      });
    }

    on('GENERATION_STARTED', (_type, _options, dryRun) => {
      if (!dryRun) reset();
    });
    on('GENERATION_AFTER_COMMANDS', (_type, _options, dryRun) => {
      const host = context();
      if (dryRun && !livePreset && host.mainApi === 'openai') gate.apply(host.chatCompletionSettings, flags);
    });
    on('CHAT_COMPLETION_PROMPT_READY', ({ dryRun } = {}) => {
      if (dryRun && livePreset) return;
      livePreset = false;
      gate.restore();
    });
    for (const key of [
      'CHAT_CHANGED', 'MESSAGE_EDITED', 'MESSAGE_DELETED', 'MESSAGE_SWIPED', 'MESSAGE_SWIPE_DELETED',
      'GENERATION_ENDED', 'GENERATION_STOPPED',
    ]) {
      on(key, () => {
        reset();
        refresh();
      });
    }
    for (const key of ['APP_READY', 'MESSAGE_RECEIVED']) on(key, refresh);
  }

  async function prepare(chat, contextSize, abort, type) {
    if (destroyed) {
      abort?.(true);
      return;
    }
    let ticket;
    try {
      bind();
      ticket = ++revision;
      const originalScope = scope();
      const enabled = flags.memory;
      function check() {
        if (destroyed || ticket !== revision || scope() !== originalScope || flags.memory !== enabled) {
          throw Error('生成期间剧情已更新，请重新发送');
        }
      }
      await ready();
      check();
      let result;
      if (enabled) {
        const current = memory();
        if (!current?.prepareGeneration) throw Error('拾忆尚未就绪');
        result = await current.prepareGeneration(chat, type, contextSize);
      } else {
        await disableMemory();
      }
      check();
      const host = context();
      if (host.mainApi === 'openai') {
        gate.apply(host.chatCompletionSettings, flags);
        livePreset = true;
      }
      cleanGenerationHistory(chat, host.chat, type);
      report({ type, result, enabled });
    } catch (error) {
      abort?.(true);
      // A late completion must not restore settings owned by a newer generation.
      if (!destroyed && (ticket === undefined || ticket === revision)) {
        reset();
        report({ error });
      }
    }
  }

  return {
    bind,
    prepare,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      unbind();
      reset();
    },
  };
}
