from rich_editor.sanitize import sanitize_html

FORMULA_MATHML = (
    '<math xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mfrac><mi>a</mi><mi>b</mi></mfrac>'
    '<annotation encoding="application/x-tex">\\frac{a}{b}</annotation></semantics></math>'
)


def test_keeps_the_editor_document_contract():
    html = (
        f'<p>Дробь <span data-formula="true" data-formula-type="math" role="img" aria-label="\\frac{{a}}{{b}}" '
        f'data-mathml="{FORMULA_MATHML.replace(chr(34), "&quot;")}" class="rte-formula">'
        '<span class="rte-formula__render" data-render-host="true">'
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -1 10 10" width="1em" height="1em" role="img">'
        '<defs><path id="g" d="M0 0h1"></path></defs><g transform="scale(1)"><use xlink:href="#g" data-c="1D44E"></use></g>'
        '</svg></span></span></p>'
        '<div data-audio="true" data-src="https://cdn.example/a.webm" data-duration="12" data-peaks="1,2,3" class="rte-audio">'
        '<audio controls="controls" preload="metadata" src="https://cdn.example/a.webm"></audio></div>'
        '<div data-attachment="true" data-href="https://cdn.example/f.txt" data-name="f.txt" data-size="12">'
        '<a href="https://cdn.example/f.txt" download="f.txt" rel="noopener noreferrer">f.txt</a></div>'
        '<table><tbody><tr><td colspan="2" style="text-align: center">x</td></tr></tbody></table>'
        '<p style="text-align: right"><span style="color: rgb(1, 2, 3); font-size: 18px">цвет</span></p>'
    )

    cleaned = sanitize_html(html)

    assert 'data-mathml="' in cleaned
    assert 'aria-label="\\frac{a}{b}"' in cleaned
    assert '<svg' in cleaned and '<use' in cleaned and 'xlink:href="#g"' in cleaned
    assert 'viewBox="0 -1 10 10"' in cleaned
    assert 'data-audio="true"' in cleaned and '<audio controls' in cleaned
    assert 'download="f.txt"' in cleaned
    assert 'colspan="2"' in cleaned
    assert 'text-align: right' in cleaned or 'text-align:right' in cleaned
    assert 'color' in cleaned and 'font-size' in cleaned


def test_drops_everything_outside_the_contract():
    html = (
        '<p>ok<script>alert(1)</script></p>'
        '<iframe src="https://evil.example"></iframe>'
        '<img src="x" onerror="alert(1)">'
        '<a href="javascript:alert(1)">j</a>'
        '<p style="position: fixed; top: 0; background: url(https://evil.example/x)">s</p>'
        '<span data-unknown="1" contenteditable="true">d</span>'
        '<annotation-xml encoding="text/html"><script>alert(2)</script></annotation-xml>'
    )

    cleaned = sanitize_html(html)

    assert 'script' not in cleaned
    assert 'iframe' not in cleaned
    assert 'onerror' not in cleaned
    assert 'javascript:' not in cleaned
    assert 'position' not in cleaned and 'url(' not in cleaned
    assert 'data-unknown' not in cleaned and 'contenteditable' not in cleaned
    assert 'annotation-xml' not in cleaned
    assert '<p>ok</p>' in cleaned
    assert '<img src="x">' in cleaned


def test_keeps_raw_mathml_from_legacy_documents():
    html = f'<p>{FORMULA_MATHML}</p>'
    cleaned = sanitize_html(html)
    assert '<mfrac>' in cleaned and '<annotation encoding="application/x-tex">' in cleaned


def test_empty_is_empty():
    assert sanitize_html('') == ''
