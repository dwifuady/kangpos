// Asked before running a script in a folder-synced space that hasn't been
// approved yet (e.g. it arrived or changed through git pull).
import { ShieldAlert } from 'lucide-react';
import { useAppStore } from '../store';
import { GhostButton, Modal, PrimaryButton } from './Modal';

export function ScriptTrustDialog() {
  const prompt = useAppStore(s => s.scriptPrompt);
  if (!prompt) return null;
  const { answer } = prompt;

  return (
    <Modal
      title="Run scripts from the workspace folder?"
      onClose={() => answer('cancel')}
      width="max-w-2xl"
      footer={
        <>
          <GhostButton onClick={() => answer('cancel')}>Cancel</GhostButton>
          <GhostButton onClick={() => answer('skip')}>Send without scripts</GhostButton>
          <GhostButton onClick={() => answer('trust-space')}>Trust all scripts in this space</GhostButton>
          <PrimaryButton onClick={() => answer('allow')} autoFocus>
            Run these scripts
          </PrimaryButton>
        </>
      }
    >
      <div className="flex gap-2.5 mb-3 text-[13px] text-[var(--text-secondary)]">
        <ShieldAlert className="w-5 h-5 text-amber-400 shrink-0" />
        <p>
          <span className="font-medium text-[var(--text-primary)]">{prompt.requestName}</span> in{' '}
          <span className="font-medium text-[var(--text-primary)]">{prompt.spaceName}</span> has scripts you haven't run before. They came
          from the linked folder (for example through git pull). Scripts run in a sandbox, but they can read and change this space's
          environment and send requests. Only run them if you trust where they came from.
        </p>
      </div>
      {(['before', 'after'] as const).map(which =>
        prompt[which].trim() ? (
          <div key={which} className="mb-2">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1">
              {which === 'before' ? 'Before request' : 'After response'}
            </div>
            <pre className="max-h-56 overflow-auto rounded-md border border-[var(--border-color)] bg-[var(--bg-tertiary)] p-2 text-[12px] font-mono whitespace-pre-wrap break-words m-0">
              {prompt[which]}
            </pre>
          </div>
        ) : null,
      )}
      <p className="text-[11px] text-[var(--text-muted)]">KangPos remembers your choice for this exact script text. If it changes again, you'll be asked again.</p>
    </Modal>
  );
}
