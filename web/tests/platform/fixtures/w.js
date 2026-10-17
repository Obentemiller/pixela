// Worker de módulo executado sob o CSP real do index.html.
try {
  const f = new Function('return 1+1');
  const v = f();
  self.postMessage({ ok: true, stage: 'newFunction', value: v, valueType: typeof v });
} catch (e) {
  self.postMessage({ ok: false, stage: 'newFunction', name: e.name, message: e.message });
}