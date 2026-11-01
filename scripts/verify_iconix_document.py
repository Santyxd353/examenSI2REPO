"""Comprueba la integridad documental; no sustituye la revisión visual del render."""
import argparse
import json
import re
from pathlib import Path
from zipfile import ZipFile
from collections import Counter
from hashlib import sha256
from lxml import etree
from pypdf import PdfReader
import pdfplumber

ROOT = Path(__file__).resolve().parents[1]
NS = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}


def verify(render):
    spec = json.loads((ROOT/'docs/saas/iconix/especificacion.json').read_text(encoding='utf8'))
    docx = ROOT/'docs/Lumina_SaaS_ICONIX_Grupo18.docx'
    source = ROOT/'docs/Plataforma_Vestidor3D_Grupo18.docx'
    assert sha256(source.read_bytes()).hexdigest() == 'd72a18adb0d7779f52b3e8f483ba5a17c34d1561b78385798e446c944e75338c'
    with ZipFile(docx) as archive:
        xml = etree.fromstring(archive.read('word/document.xml'))
        settings = etree.fromstring(archive.read('word/settings.xml'))
    text = '\n'.join(''.join(p.xpath('.//w:t/text()', namespaces=NS)) for p in xml.xpath('//w:p', namespaces=NS))
    anchors = set(xml.xpath('//w:bookmarkStart/@w:name', namespaces=NS))
    targets = xml.xpath('//w:hyperlink/@w:anchor', namespaces=NS)
    missing = sorted(set(targets)-anchors)
    assert not missing, f'Enlaces internos sin destino: {missing}'
    assert len(spec['requirements']) == 54 and len(spec['cases']) == 27
    assert all(r['id'] in text for r in spec['requirements'])
    assert all(any(r['id'] in c['requirements'] for c in spec['cases']) for r in spec['requirements'])
    for case in spec['cases']:
        assert all(a in anchors for a in (case['id'], 'R_'+case['id'], 'S_'+case['id'], 'C_'+case['id']))
        assert all(rule in text for rule in case['rules']), f"Regla ausente en {case['id']}"
    tables = spec['data']['existing_tables']+spec['data']['new_tables']
    assert len(tables) == 59 and all(t['name'] in text for t in tables)
    # Word localiza el identificador de Caption como Descripcin en español.
    captions = re.findall(r'^Figura (\d+)\s',text,flags=re.MULTILINE)
    assert [int(n) for n in captions] == list(range(1,112))
    assert 'TOC ' in ''.join(xml.xpath('//w:instrText/text()', namespaces=NS))
    normalized=' '.join(text.split())
    assert normalized.count('ESTUDIANTE: Pérez Arauco Juan Carlos 223093637') == 2
    assert normalized.count('ESTUDIANTE: Sánchez Paniagua Felix Santiago 222115203') == 2
    assert all(x in text for x in ['Recomendaciones', 'Bibliografía', '149', '299', '599'])
    assert 'STOCK_DELTA' in text and 'STOCK_ADJUST' not in text
    pdf = render/(docx.stem+'.pdf')
    reader = PdfReader(pdf)
    links = Counter()
    page_ids={p.indirect_reference.idnum for p in reader.pages}
    for page in reader.pages:
        for ref in page.get('/Annots', []):
            annot = ref.get_object()
            if annot.get('/Subtype') == '/Link':
                action = annot.get('/A', {})
                links['external' if action.get('/S') == '/URI' else 'internal'] += 1
                destination=annot.get('/Dest') or action.get('/D')
                if destination is not None and not isinstance(destination,str):
                    assert destination[0].idnum in page_ids, 'Destino PDF sin página válida'
    assert links['internal'] > 100 and links['external'] >= 15
    pages = []
    with pdfplumber.open(pdf) as document:
        for i,page in enumerate(document.pages,1):
            content = page.extract_text() or ''
            outside = [c for c in page.chars if c['x0'] < -1 or c['x1'] > page.width+1 or c['top'] < -1 or c['bottom'] > page.height+1]
            assert not outside, f'Texto fuera de la página {i}'
            assert '\ufffd' not in content, f'Carácter de sustitución en página {i}'
            assert len(content.strip()) > 4 or page.images, f'Página vacía {i}'
            assert (render/f'page-{i}.png').is_file()
            pages.append({'page':i,'chars':len(content),'images':len(page.images),'start':content[:140]})
    report = {'requirements':54,'use_cases':27,'tables':59,'figures':len(captions),'pages':len(reader.pages),
              'links':dict(links),'bookmarks':len(anchors),'missing_anchors':missing,
              'sparse_text_pages':[p for p in pages if p['chars'] < 220 and p['images'] == 0],
              'visual_review':'Se registra por separado; esta comprobación no evalúa imágenes'}
    (render/'page-map.json').write_text(json.dumps(pages,ensure_ascii=False,indent=2),encoding='utf8')
    (render/'structural-check.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
    print(json.dumps(report,ensure_ascii=False,indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('render', type=Path)
    args = parser.parse_args()
    verify(args.render.resolve())
