/**
 * Ленивая загрузка JSXGraph.
 *
 * Библиотека весит около мегабайта, поэтому грузится при первом построении,
 * как MathJax у формул: документ без геометрии за неё не платит.
 */
export type JsxGraphModule = typeof import('jsxgraph');

let modulePromise: Promise<JsxGraphModule> | null = null;

/**
 * JessieCode по умолчанию компилирует функции в JS через `eval`. Интерпретатор
 * медленнее, но формулы пользователя не превращаются в код, а страница со
 * строгой CSP не ломается. Настройка глобальная: атрибут доски её не меняет.
 */
const configure = (jsxgraph: JsxGraphModule): JsxGraphModule => {
  (jsxgraph.Options as { jc: { compile: boolean } }).jc.compile = false;

  return jsxgraph;
};

export const loadJsxGraph = (): Promise<JsxGraphModule> => {
  modulePromise ??= import('jsxgraph').then(configure);

  return modulePromise;
};
