import { type BaseLocator, describeLocator } from '@flowcheck/shared';
import { Wand2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Notice } from '@/components/ui/states';
import { t } from '@/i18n';
import { cn } from '@/lib/utils';
import { type LocatorSuggestion, type SuggestResult, suggestLocatorsFromHtml } from './suggest-locators';

const QUALITY_STYLE = {
  best: 'bg-success/15 text-success',
  good: 'bg-primary/10 text-primary',
  fragile: 'bg-warning/20 text-foreground',
} as const;

/** Paste an element's HTML from DevTools and pick one of the suggested locators. */
export function SuggestFromHtmlDialog({ onPick }: { onPick: (locator: BaseLocator) => void }) {
  const [open, setOpen] = useState(false);
  const [html, setHtml] = useState('');
  const [result, setResult] = useState<SuggestResult | null>(null);

  const analyse = (text: string) => {
    setHtml(text);
    setResult(text.trim() ? suggestLocatorsFromHtml(text) : null);
  };
  const pick = (suggestion: LocatorSuggestion) => {
    onPick(suggestion.locator);
    setOpen(false);
    analyse('');
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="self-start">
          <Wand2 /> {t.suggest.button}
        </Button>
      </DialogTrigger>
      <DialogContent title={t.suggest.title} description={t.suggest.howTo} className="w-[min(720px,calc(100vw-2rem))]">
        <div className="flex flex-col gap-3">
          <Field label={t.suggest.pasteLabel} htmlFor="suggest-html">
            <Textarea
              id="suggest-html"
              rows={5}
              autoFocus
              spellCheck={false}
              value={html}
              placeholder={'<button class="…" aria-label="Hesab">…</button>'}
              onChange={(e) => analyse(e.target.value)}
            />
          </Field>
          {result && !result.ok ? <Notice tone="warning">{t.suggest.errors[result.error]}</Notice> : null}
          {result?.ok && result.suggestions.length === 0 ? <Notice tone="warning">{t.suggest.none}</Notice> : null}
          {result?.ok && result.suggestions.length > 0 ? (
            <>
              <ul className="flex flex-col gap-2" aria-label={t.suggest.listLabel}>
                {result.suggestions.map((suggestion) => (
                  <li
                    key={JSON.stringify(suggestion.locator)}
                    className="flex items-center justify-between gap-3 rounded-md border border-border p-2 text-sm"
                  >
                    <div className="min-w-0">
                      <span className={cn('mr-2 rounded px-1.5 py-0.5 text-xs font-medium', QUALITY_STYLE[suggestion.quality])}>
                        {t.suggest.quality[suggestion.quality]}
                      </span>
                      <span className="font-medium">{t.steps.locatorKinds[suggestion.locator.kind]}</span>
                      <p className="break-all font-mono text-xs">{describeLocator(suggestion.locator)}</p>
                      <p className="text-xs text-muted-foreground">{t.suggest.reasons[suggestion.reason]}</p>
                    </div>
                    <Button size="sm" onClick={() => pick(suggestion)}>
                      {t.suggest.use}
                    </Button>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground">{t.suggest.uniqueNote}</p>
            </>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
