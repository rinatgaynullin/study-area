from django.template import Context, Template


def render(source: str, **context) -> str:
    return Template('{% load rich_editor %}' + source).render(Context(context))


def test_editor_assets_link_styles_and_module_script():
    html = render('{% rich_editor_assets %}')
    assert '<link rel="stylesheet" href="/static/rich_editor/styles.css">' in html
    assert 'legacy.css' not in html
    assert '<script type="module" src="/static/rich_editor/rich_editor.js"></script>' in html

    assert 'href="/static/rich_editor/legacy.css"' in render('{% rich_editor_assets legacy=True %}')


def test_viewer_assets_use_the_light_entry():
    html = render('{% rich_viewer_assets %}')
    assert 'rich_editor_viewer.js' in html
    assert 'rich_editor.js"' not in html


def test_rich_content_wraps_document_without_resanitizing():
    html = render('{% rich_content body %}', body='<p onclick="x()">текст</p>')
    assert html == '<div class="rte-content-root rte-content" data-rich-content><p onclick="x()">текст</p></div>'


def test_rich_content_legacy_and_sanitize():
    html = render('{% rich_content body legacy=True sanitize=True %}', body='<p>a<script>b</script></p>')
    assert html.startswith('<div class="rte-content-root rte-content rte-legacy" data-rich-content data-legacy>')
    assert '<script' not in html and '<p>a</p>' in html


def test_rich_content_tolerates_empty():
    assert render('{% rich_content body %}', body=None).endswith('data-rich-content></div>')
