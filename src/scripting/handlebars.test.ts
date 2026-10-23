import { describe, expect, it } from 'vitest';
import { renderTemplate } from './handlebars';

describe('visualizer templates', () => {
  it('renders values, escapes HTML and keeps triple braces raw', () => {
    expect(renderTemplate('<p>{{name}}</p>{{{name}}}', { name: '<b>Ada</b>' })).toBe('<p>&lt;b&gt;Ada&lt;/b&gt;</p><b>Ada</b>');
  });

  it('iterates arrays and objects with the @ data variables', () => {
    expect(
      renderTemplate(
        '<ul>{{#each items}}<li>{{@index}}:{{name}}{{#if @last}} (last){{/if}}</li>{{else}}none{{/each}}</ul>',
        { items: [{ name: 'a' }, { name: 'b' }] },
      ),
    ).toBe('<ul><li>0:a</li><li>1:b (last)</li></ul>');

    expect(renderTemplate('{{#each map}}{{@key}}={{this}};{{/each}}', { map: { a: 1, b: 2 } })).toBe('a=1;b=2;');
    expect(renderTemplate('{{#each items}}x{{else}}empty{{/each}}', { items: [] })).toBe('empty');
  });

  it('handles if / unless / with and parent paths', () => {
    expect(renderTemplate('{{#if ok}}yes{{else}}no{{/if}} {{#unless ok}}hidden{{/unless}}', { ok: false })).toBe('no hidden');
    expect(renderTemplate('{{#with user}}{{name}} of {{../company}}{{/with}}', { user: { name: 'Ada' }, company: 'ACME' })).toBe('Ada of ACME');
    expect(renderTemplate('{{#with missing}}x{{else}}fallback{{/with}}', {})).toBe('fallback');
  });

  it('supports lookup, comments, dotted paths and @root', () => {
    expect(renderTemplate('{{lookup codes "a"}} {{! ignored }}{{user.name}} {{@root.title}}', { codes: { a: 'x' }, user: { name: 'Ada' }, title: 'T' })).toBe('x Ada T');
  });

  it('reports broken templates instead of rendering silently', () => {
    expect(() => renderTemplate('{{#each items}}', { items: [] })).toThrow(/Missing \{\{\/each\}\}/);
    expect(() => renderTemplate('{{#widget}}x{{/widget}}', {})).toThrow(/Unknown helper/);
  });
});
