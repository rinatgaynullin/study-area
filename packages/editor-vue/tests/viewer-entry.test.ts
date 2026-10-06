import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import * as viewer from '../src/viewer';

describe('вход @rich-editor/vue/viewer', () => {
  it('отдаёт <RichContent /> и ванильный вьюер, но не редактор', () => {
    expect(viewer.RichContent).toBeTruthy();
    expect(typeof viewer.createRichContent).toBe('function');
    expect('RichEditor' in viewer).toBe(false);
    expect('RichEditorPlugin' in viewer).toBe(false);
  });

  it('<RichContent /> из входа вьюера показывает документ', async () => {
    const w = mount(viewer.RichContent, { props: { html: '<p>привет</p>' } });

    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });

    expect(w.find('.rte-content').text()).toBe('привет');

    w.unmount();
  });
});
