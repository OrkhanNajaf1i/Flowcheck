import { describe, expect, it } from 'vitest';
import { suggestLocatorsFromHtml } from '@/features/editor/suggest-locators';

function suggest(html: string) {
  const result = suggestLocatorsFromHtml(html);
  if (!result.ok) throw new Error(result.error);
  return result.suggestions;
}

describe('suggestLocatorsFromHtml', () => {
  it('prefers the aria-label name of an icon button over its generated id', () => {
    const html = `<button data-slot="dropdown-menu-trigger" class="inline-flex items-center gap-2 size-8" id="reka-dropdown-menu-trigger-v-31" type="button" aria-label="Hesab"><svg class="lucide"></svg></button>`;
    const s = suggest(html);
    expect(s[0]).toEqual({ locator: { kind: 'role', role: 'button', name: 'Hesab' }, quality: 'best', reason: 'role' });
    expect(s.at(-1)).toEqual({
      locator: { kind: 'id', value: 'reka-dropdown-menu-trigger-v-31' },
      quality: 'fragile',
      reason: 'generatedId',
    });
  });

  it('never suggests layout classes or DOM paths', () => {
    const html = `<button class="inline-flex items-center justify-center bg-primary h-8 px-3 has-[>svg]:px-2.5" data-slot="button"><svg></svg> Yadda saxla </button>`;
    const s = suggest(html);
    expect(s).toEqual([{ locator: { kind: 'role', role: 'button', name: 'Yadda saxla' }, quality: 'best', reason: 'role' }]);
    expect(JSON.stringify(s)).not.toContain('inline-flex');
  });

  it('puts data-testid first and suggests field handles for inputs', () => {
    const s = suggest(`<input data-testid="email" name="email" placeholder="you@example.com" aria-label="Email address" id="email-input">`);
    expect(s.map((x) => x.locator.kind)).toEqual(['testId', 'role', 'label', 'placeholder', 'attribute', 'id']);
    expect(s[1]?.locator).toEqual({ kind: 'role', role: 'textbox', name: 'Email address' });
  });

  it('handles links, images, headings and plain text', () => {
    expect(suggest('<a href="/login">Daxil ol</a>')[0]?.locator).toEqual({ kind: 'role', role: 'link', name: 'Daxil ol' });
    expect(suggest('<img src="x.png" alt="Logo">').map((x) => x.locator.kind)).toEqual(['role', 'altText']);
    expect(suggest('<h2>Sifarişlər</h2>')[0]?.locator).toEqual({ kind: 'role', role: 'heading', name: 'Sifarişlər' });
    expect(suggest('<span class="badge">Yeni</span>')).toEqual([
      { locator: { kind: 'text', value: 'Yeni', exact: true }, quality: 'good', reason: 'text' },
    ]);
  });

  it('suggests other test attributes and the explicit role', () => {
    const s = suggest('<div role="tab" data-qa="orders-tab">Orders</div>');
    expect(s.map((x) => x.locator)).toEqual([
      { kind: 'attribute', name: 'data-qa', value: 'orders-tab' },
      { kind: 'role', role: 'tab', name: 'Orders' },
    ]);
  });

  it('does not run scripts or event handlers in the pasted HTML', () => {
    const marker = globalThis as { __flowcheckInjected?: boolean };
    suggestLocatorsFromHtml(
      '<button onclick="globalThis.__flowcheckInjected = true">X</button><script>globalThis.__flowcheckInjected = true</script><img src=x onerror="globalThis.__flowcheckInjected = true">',
    );
    expect(marker.__flowcheckInjected).toBeUndefined();
  });

  it('reports empty and oversized input', () => {
    expect(suggestLocatorsFromHtml('just text')).toEqual({ ok: false, error: 'empty' });
    expect(suggestLocatorsFromHtml(`<div>${'x'.repeat(200_001)}</div>`)).toEqual({ ok: false, error: 'tooLarge' });
  });
});
