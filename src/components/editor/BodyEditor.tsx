import { WandSparkles } from 'lucide-react';
import type { BodyType, RequestBody } from '../../types';
import type { ResolveContext } from '../../utils/variables';
import { CodeEditor } from './CodeEditor';
import { KeyValueTable, makeBodyField } from './KeyValueTable';
import { formatJsonWithPlaceholders } from '../../utils/format';

const TYPES: { value: BodyType; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'json', label: 'JSON' },
  { value: 'text', label: 'Text' },
  { value: 'xml', label: 'XML' },
  { value: 'form-urlencoded', label: 'Form URL-encoded' },
  { value: 'multipart', label: 'Multipart' },
];

interface BodyEditorProps {
  body: RequestBody;
  onChange: (body: RequestBody) => void;
  ctx: ResolveContext;
  tabId: string;
  spaceColor: string;
}

export function BodyEditor({ body, onChange, ctx, tabId, spaceColor }: BodyEditorProps) {
  const isRaw = body.type === 'json' || body.type === 'text' || body.type === 'xml';
  return (
    <div className="flex flex-col h-full min-h-0 gap-2">
      <div className="flex items-center gap-1 flex-wrap">
        {TYPES.map(t => (
          <button
            key={t.value}
            onClick={() => onChange({ ...body, type: t.value })}
            className={`px-2 py-0.5 rounded-md text-[12px] ${
              body.type === t.value ? 'font-medium text-[var(--text-primary)]' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
            }`}
            style={body.type === t.value ? { backgroundColor: `${spaceColor}30` } : undefined}
          >
            {t.label}
          </button>
        ))}
        {body.type === 'json' && (
          <button
            onClick={() => {
              const formatted = formatJsonWithPlaceholders(body.raw);
              if (formatted !== null) onChange({ ...body, raw: formatted });
            }}
            className="ml-auto flex items-center gap-1 px-2 py-0.5 rounded-md text-[12px] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
            title="Format JSON"
          >
            <WandSparkles className="w-3.5 h-3.5" /> Format
          </button>
        )}
      </div>

      {body.type === 'none' && <p className="text-[12px] text-[var(--text-muted)]">This request has no body.</p>}
      {isRaw && (
        <div className="flex-1 min-h-[120px]">
          <CodeEditor
            path={`kangpos://tab/${tabId}/body.${body.type === 'json' ? 'json' : body.type === 'xml' ? 'xml' : 'txt'}`}
            value={body.raw}
            language={body.type === 'json' ? 'json' : body.type === 'xml' ? 'xml' : 'plaintext'}
            onChange={raw => onChange({ ...body, raw })}
            variables={ctx}
            checkJson={body.type === 'json'}
          />
        </div>
      )}
      {isRaw && (
        <p className="text-[11px] text-[var(--text-muted)] -mt-1">
          Type <span className="font-mono">{'{{'}</span> to insert an input or variable. Values are inserted as plain text
          {body.type === 'json' && (
            <>
              , so text needs quotes: <span className="font-mono">{'"nama": "{{nama}}"'}</span>. Numbers and true/false
              don't: <span className="font-mono">{'"jumlah": {{jumlah}}'}</span>
            </>
          )}
          .
        </p>
      )}
      {(body.type === 'form-urlencoded' || body.type === 'multipart') && (
        <div className="overflow-y-auto">
          <KeyValueTable
            rows={body.fields}
            onChange={fields => onChange({ ...body, fields })}
            ctx={ctx}
            makeRow={makeBodyField}
            keyPlaceholder="Field"
            withKind={body.type === 'multipart'}
          />
        </div>
      )}
    </div>
  );
}
