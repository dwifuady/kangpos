// "Scripts" section: JavaScript run before the request and after the response.
import { useEffect, useState } from 'react';
import type { RequestScripts } from '../../types';
import { CodeEditor } from './CodeEditor';

type Which = keyof RequestScripts;

const SNIPPETS: Record<Which, { label: string; code: string }[]> = {
  before: [
    { label: 'Set a variable for this request', code: "pm.variables.set('name', 'value');" },
    { label: 'Add a header', code: "pm.request.headers.upsert({ key: 'X-Request-Id', value: crypto.randomUUID() });" },
    { label: 'Timestamp variable', code: "pm.variables.set('timestamp', new Date().toISOString());" },
    { label: 'Sign with HMAC-SHA256', code: "const CryptoJS = require('crypto-js');\npm.variables.set('signature', CryptoJS.HmacSHA256(pm.variables.get('body'), pm.variables.get('secret')).toString());" },
    {
      label: 'Get a token first',
      code: [
        'const res = await pm.sendRequest({',
        "  url: pm.environment.get('baseUrl') + '/auth/token',",
        "  method: 'POST',",
        "  header: { 'Content-Type': 'application/json' },",
        "  body: { mode: 'raw', raw: JSON.stringify({ clientId: pm.environment.get('clientId'), clientSecret: pm.environment.get('clientSecret') }) },",
        '});',
        "pm.environment.set('token', res.json().access_token);",
      ].join('\n'),
    },
  ],
  after: [
    { label: 'Status is 200', code: "pm.test('Status is 200', () => pm.response.to.have.status(200));" },
    { label: 'Check a JSON field', code: "pm.test('Has id', () => pm.expect(pm.response.json()).to.have.property('id'));" },
    { label: 'Save a value to the environment', code: "pm.environment.set('id', pm.response.json().id);" },
    { label: 'Response time below 1 s', code: "pm.test('Fast enough', () => pm.expect(pm.response.responseTime).to.be.below(1000));" },
    { label: 'Log the response', code: 'console.log(pm.response.json());' },
    {
      label: 'Visualize the response',
      code: [
        'const items = pm.response.json();',
        "pm.visualizer.set('<h3>{{title}}</h3><ul>{{#each items}}<li>{{name}}</li>{{/each}}</ul>', { title: 'Items', items });",
      ].join('\n'),
    },
  ],
};

const LABEL: Record<Which, string> = { before: 'Before request', after: 'After response' };

interface ScriptsEditorProps {
  scripts: RequestScripts;
  onChange: (scripts: RequestScripts) => void;
  tabId: string;
  spaceColor: string;
}

export function ScriptsEditor({ scripts, onChange, tabId, spaceColor }: ScriptsEditorProps) {
  const pickDefault = (): Which => (scripts.before.trim() === '' && scripts.after.trim() !== '' ? 'after' : 'before');
  const [which, setWhich] = useState<Which>(pickDefault);
  useEffect(() => setWhich(pickDefault()), [tabId]); // eslint-disable-line react-hooks/exhaustive-deps -- per tab

  const insert = (code: string) => {
    const current = scripts[which];
    const next = current.trim() === '' ? code : `${current.replace(/\s*$/, '')}\n\n${code}`;
    onChange({ ...scripts, [which]: next });
  };

  return (
    <div className="flex flex-col h-full min-h-0 gap-2">
      <div className="flex items-center gap-1 flex-wrap">
        {(['before', 'after'] as Which[]).map(w => (
          <button
            key={w}
            onClick={() => setWhich(w)}
            className={`flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[12px] ${
              which === w ? 'font-medium text-[var(--text-primary)]' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
            }`}
            style={which === w ? { backgroundColor: `${spaceColor}30` } : undefined}
          >
            {LABEL[w]}
            {scripts[w].trim() !== '' && <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: spaceColor }} aria-label="has a script" />}
          </button>
        ))}
        <select
          value=""
          onChange={e => {
            const snippet = SNIPPETS[which].find(s => s.label === e.target.value);
            if (snippet) insert(snippet.code);
          }}
          className="ml-auto h-6 px-1.5 text-[12px] rounded"
          aria-label="Insert snippet"
        >
          <option value="">Insert snippet…</option>
          {SNIPPETS[which].map(s => (
            <option key={s.label} value={s.label}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex-1 min-h-[120px]">
        <CodeEditor
          path={`kangpos://tab/${tabId}/script-${which}.js`}
          value={scripts[which]}
          language="javascript"
          onChange={code => onChange({ ...scripts, [which]: code })}
        />
      </div>
      <p className="text-[11px] text-[var(--text-muted)] -mt-1">
        {which === 'before'
          ? 'Runs before {{placeholders}} are filled in, so values you set are used by this request. '
          : 'Runs when the response arrives. Use pm.test for checks and pm.environment.set to keep values for later requests. '}
        Postman-style API: <span className="font-mono">pm.environment, pm.variables, pm.request, pm.response, pm.test, pm.expect, pm.sendRequest, pm.visualizer, console.log</span>.
        Runs in a sandbox with a 10 s limit. Libraries via <span className="font-mono">require()</span>: crypto-js, crypto, lodash (also{' '}
        <span className="font-mono">_</span>), moment, uuid, buffer, querystring, chai.
      </p>
    </div>
  );
}
