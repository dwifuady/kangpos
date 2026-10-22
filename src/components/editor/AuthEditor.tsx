import type { AuthSpec } from '../../types';
import type { ResolveContext } from '../../utils/variables';
import { HighlightInput } from './HighlightInput';

const TYPES: { value: AuthSpec['type']; label: string }[] = [
  { value: 'none', label: 'No auth' },
  { value: 'bearer', label: 'Bearer token' },
  { value: 'basic', label: 'Basic' },
  { value: 'apikey', label: 'API key' },
];

function blank(type: AuthSpec['type']): AuthSpec {
  switch (type) {
    case 'bearer':
      return { type, token: '{{token}}' };
    case 'basic':
      return { type, username: '', password: '' };
    case 'apikey':
      return { type, key: 'X-API-Key', value: '', in: 'header' };
    default:
      return { type: 'none' };
  }
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_1fr] items-center gap-2">
      <span className="text-[12px] text-[var(--text-secondary)]">{label}</span>
      {children}
    </div>
  );
}

const fieldClass = 'h-8 rounded border border-[var(--border-color)] bg-[var(--bg-tertiary)] font-mono text-[13px] focus-within:border-b-[var(--accent-color)]';

export function AuthEditor({ auth, onChange, ctx }: { auth: AuthSpec; onChange: (auth: AuthSpec) => void; ctx: ResolveContext }) {
  return (
    <div className="flex flex-col gap-2.5 max-w-xl">
      <Field label="Type">
        <select value={auth.type} onChange={e => onChange(blank(e.target.value as AuthSpec['type']))} className="h-8 px-2 text-[13px] rounded w-48">
          {TYPES.map(t => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </Field>
      {auth.type === 'bearer' && (
        <Field label="Token">
          <HighlightInput value={auth.token} onChange={token => onChange({ ...auth, token })} ctx={ctx} placeholder="{{token}}" className={fieldClass} />
        </Field>
      )}
      {auth.type === 'basic' && (
        <>
          <Field label="Username">
            <HighlightInput value={auth.username} onChange={username => onChange({ ...auth, username })} ctx={ctx} className={fieldClass} />
          </Field>
          <Field label="Password">
            <HighlightInput value={auth.password} onChange={password => onChange({ ...auth, password })} ctx={ctx} className={fieldClass} />
          </Field>
        </>
      )}
      {auth.type === 'apikey' && (
        <>
          <Field label="Key">
            <HighlightInput value={auth.key} onChange={key => onChange({ ...auth, key })} ctx={ctx} className={fieldClass} />
          </Field>
          <Field label="Value">
            <HighlightInput value={auth.value} onChange={value => onChange({ ...auth, value })} ctx={ctx} placeholder="{{apiKey}}" className={fieldClass} />
          </Field>
          <Field label="Add to">
            <select value={auth.in} onChange={e => onChange({ ...auth, in: e.target.value as 'header' | 'query' })} className="h-8 px-2 text-[13px] rounded w-48">
              <option value="header">Header</option>
              <option value="query">Query string</option>
            </select>
          </Field>
        </>
      )}
      <p className="text-[11px] text-[var(--text-muted)]">
        Tip: keep secrets in the environment and reference them, e.g. <span className="font-mono">{'{{token}}'}</span>. An explicit Authorization header wins over this setting.
      </p>
    </div>
  );
}
