/**
 * Cookie-free visit counter hook.
 *
 * Disabled. Mossgate Puzzles does not load analytics, ads, or other
 * third-party scripts.
 *
 * To enable GoatCounter later, set `enabled` to true and `src` to the
 * site count URL, for example "https://mossgate.goatcounter.com/count".
 * GoatCounter's count script does not use cookies. Nothing is injected
 * while `enabled` is false.
 */
export const visitCounter = {
  enabled: false,
  provider: 'goatcounter' as const,
  src: '',
};

export function visitCounterScript(): { src: string; endpoint: string } | null {
  if (!visitCounter.enabled || !visitCounter.src) return null;
  return {
    src: 'https://gc.zgo.at/count.js',
    endpoint: visitCounter.src,
  };
}

export function installVisitCounter(doc: Document = document): void {
  const config = visitCounterScript();
  if (!config) return;
  if (doc.querySelector('script[data-mossgate-counter]')) return;
  const script = doc.createElement('script');
  script.async = true;
  script.src = config.src;
  script.dataset.goatcounter = config.endpoint;
  script.dataset.mossgateCounter = 'goatcounter';
  doc.head.appendChild(script);
}
