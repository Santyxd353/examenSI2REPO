"""Diagramas UML deterministas en SVG y PNG para el informe ICONIX.

Usar el Python de las dependencias de documentos de Codex. No modifica imágenes
del documento de referencia; dibuja geometría y texto de los modelos definidos.
"""
from pathlib import Path
from html import escape
import math
import re
from PIL import Image, ImageDraw, ImageFont

FONT = Path('C:/Windows/Fonts/arial.ttf')
BOLD = Path('C:/Windows/Fonts/arialbd.ttf')


def words(value):
    text=re.sub(r'(?<=[A-ZÁÉÍÓÚÑ])(?=[A-ZÁÉÍÓÚÑ][a-záéíóúñ])',' ',str(value))
    return re.sub(r'(?<=[a-záéíóúñ])(?=[A-ZÁÉÍÓÚÑ])', ' ', text).replace('_', ' ')


class Drawing:
    def __init__(self, width, height):
        self.w, self.h = width, height
        self.image = Image.new('RGB', (width * 2, height * 2), 'white')
        self.draw = ImageDraw.Draw(self.image)
        self.svg = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}"><rect width="100%" height="100%" fill="white"/>']

    def font(self, size=24, bold=False):
        return ImageFont.truetype(str(BOLD if bold else FONT), size * 2)

    def measure(self, text, size=24, bold=False):
        return self.font(size, bold).getlength(str(text)) / 2

    def wrap(self, text, width, size=24, bold=False):
        result = []
        for raw in str(text).split('\n'):
            line = ''
            for token in raw.split():
                if self.measure((line + ' ' + token).strip(), size, bold) <= width:
                    line = (line + ' ' + token).strip()
                else:
                    if self.measure(token,size,bold)<=width and line.strip() not in {'+','-'}:
                        if line:result.append(line)
                        line=token
                        continue
                    # Cortar identificadores por CamelCase conserva palabras y
                    # evita dejar el prefijo + o los paréntesis en renglón propio.
                    remaining=token
                    while remaining:
                        prefix=(line+' ') if line else ''
                        available=width-self.measure(prefix,size,bold)
                        if self.measure(remaining,size,bold)<=available:
                            line=prefix+remaining;break
                        end=1
                        while end<len(remaining) and self.measure(remaining[:end+1],size,bold)<=available:end+=1
                        boundaries=[m.start() for m in re.finditer(r'(?<=[a-záéíóúñ0-9])(?=[A-ZÁÉÍÓÚÑ])|(?<=[A-ZÁÉÍÓÚÑ])(?=[A-ZÁÉÍÓÚÑ][a-záéíóúñ])|_',remaining) if 0<m.start()<=end]
                        if boundaries:end=boundaries[-1]
                        if line and end<3:
                            result.append(line);line='';continue
                        result.append(prefix+remaining[:end]);remaining=remaining[end:];line=''
            result.append(line)
        return result

    def rect(self, x, y, w, h, fill='white', stroke='#222222', thickness=2):
        self.draw.rectangle((x*2,y*2,(x+w)*2,(y+h)*2), fill=fill, outline=stroke, width=thickness*2)
        self.svg.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" fill="{fill}" stroke="{stroke}" stroke-width="{thickness}"/>')

    def ellipse(self, x, y, w, h, fill='white', stroke='#222222', thickness=2):
        self.draw.ellipse((x*2,y*2,(x+w)*2,(y+h)*2), fill=fill, outline=stroke, width=thickness*2)
        self.svg.append(f'<ellipse cx="{x+w/2}" cy="{y+h/2}" rx="{w/2}" ry="{h/2}" fill="{fill}" stroke="{stroke}" stroke-width="{thickness}"/>')

    def line(self, points, color='#222222', width=2, dashed=False, arrow=False):
        if dashed:
            for a, b in zip(points, points[1:]):
                dx,dy=b[0]-a[0],b[1]-a[1]; length=math.hypot(dx,dy)
                for start in range(0,int(length),14):
                    end=min(start+8,length)
                    if length:
                        self.draw.line(((a[0]+dx*start/length)*2,(a[1]+dy*start/length)*2,(a[0]+dx*end/length)*2,(a[1]+dy*end/length)*2),fill=color,width=width*2)
        else:
            self.draw.line([(x*2,y*2) for x,y in points],fill=color,width=width*2)
        coords=' '.join(f'{x},{y}' for x,y in points)
        self.svg.append(f'<polyline points="{coords}" fill="none" stroke="{color}" stroke-width="{width}"'+(' stroke-dasharray="8 6"' if dashed else '')+'/>')
        if arrow and len(points)>1:
            a,b=points[-2],points[-1];theta=math.atan2(b[1]-a[1],b[0]-a[0]);size=11
            pts=[b,(b[0]-size*math.cos(theta-0.4),b[1]-size*math.sin(theta-0.4)),(b[0]-size*math.cos(theta+0.4),b[1]-size*math.sin(theta+0.4))]
            self.draw.polygon([(x*2,y*2) for x,y in pts],fill=color)
            self.svg.append('<polygon points="'+' '.join(f'{x},{y}' for x,y in pts)+f'" fill="{color}"/>')

    def text(self, x, y, text, size=24, bold=False, anchor='left', color='#111111', max_width=None, background=False):
        lines=self.wrap(text,max_width,size,bold) if max_width else str(text).split('\n')
        line_height=size+7
        for i,line in enumerate(lines):
            left=x-self.measure(line,size,bold)/(2 if anchor=='center' else 1) if anchor!='left' else x
            if background:
                self.rect(left-4,y+i*line_height-2,self.measure(line,size,bold)+8,line_height,stroke='white',fill='white',thickness=0)
            self.draw.text((left*2,(y+i*line_height)*2),line,font=self.font(size,bold),fill=color,anchor='lt')
            self.svg.append(f'<text x="{left}" y="{y+i*line_height+size*0.82}" font-family="Arial" font-size="{size}" font-weight="'+('bold' if bold else 'normal')+f'" fill="{color}">{escape(line)}</text>')
        return len(lines)*line_height

    def save(self,path):
        path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
        self.image.save(path.with_suffix('.png'),optimize=True)
        path.with_suffix('.svg').write_text('\n'.join(self.svg+['</svg>']),encoding='utf8')
        return path.with_suffix('.png')


def actor(d,x,y,label):
    d.ellipse(x-17,y-70,34,34)
    d.line([(x,y-36),(x,y+32)])
    d.line([(x-35,y-12),(x+35,y-12)])
    d.line([(x,y+32),(x-30,y+75)]);d.line([(x,y+32),(x+30,y+75)])
    d.text(x,y+86,label,22,anchor='center',max_width=180)


def robustness(case,path):
    d=Drawing(1260,740);entities=case['entities'][:3]
    actor(d,90,310,case['actor'])
    d.ellipse(275,268,84,84);d.line([(260,258),(260,362)]);d.line([(260,310),(275,310)])
    d.text(317,378,'«frontera»',23,anchor='center');d.text(317,415,words(case['boundary']),25,True,'center',max_width=285)
    d.ellipse(610,268,84,84);d.line([(664,269),(680,255),(685,277)],arrow=True)
    d.text(652,378,'«control»',23,anchor='center');d.text(652,415,words(case['control']),25,True,'center',max_width=300)
    d.line([(133,310),(255,310)]);d.line([(363,310),(605,310)])
    d.text(195,270,'solicita',21,anchor='center',background=True)
    d.text(483,270,'valida y coordina',21,anchor='center',background=True)
    ys={1:[310],2:[200,495],3:[150,345,540]}[len(entities)]
    for i,(entity,y) in enumerate(zip(entities,ys)):
        d.ellipse(1050,y-42,84,84);d.line([(1040,y+49),(1144,y+49)])
        d.text(1092,y+62,'«entidad»',22,anchor='center')
        d.text(1092,y+99,words(entity),24,True,'center',max_width=295)
        route_x=891-i*28
        d.line([(698,310),(route_x,310),(route_x,y),(1045,y)])
        d.text(965,y-30,f'{i+1} consulta / registra',20,anchor='center',background=True)
    d.text(40,686,'Las entidades pertenecen al contexto de tienda validado por el control.',22)
    return d.save(path)


def sequence(case,path):
    entities=case['entities'][:3]
    nodes=['actor','boundary','control',*entities]
    labels=[case['actor'],case['boundary'],case['control'],*entities]
    count=len(nodes); gap=1160/(count-1);xs={node:50+i*gap for i,node in enumerate(nodes)}
    # Centers have room for participant labels at both page edges.
    xs={node:112+i*1036/(count-1) for i,node in enumerate(nodes)}
    messages=case['messages']
    captions=[re.sub(r'\([^)]*\)', '()', re.sub(r'^\d+[.\s)]*','',m['text'])) for m in messages]
    helper=Drawing(1260,10)
    participant_width=185 if count<=5 else 174
    header_height=max(120,45+29*max(len(helper.wrap(words(label),participant_width-10,22,True)) for label in labels))
    message_top=header_height+55
    legend=[helper.wrap(f'{i+1}. {text}',1185,22) for i,text in enumerate(captions)]
    legend_top=message_top+20+len(messages)*72
    h=legend_top+55+sum(len(lines)*29+7 for lines in legend)+30
    d=Drawing(1260,h)
    for idx,(node,label) in enumerate(zip(nodes,labels)):
        x=xs[node];w=participant_width
        d.rect(x-w/2,22,w,header_height,fill='#f3f3f3')
        stereotype=['actor','frontera','control',*['entidad']*len(entities)][idx]
        d.text(x,32,'«'+stereotype+'»',20,anchor='center')
        label_size=21 if len(words(label).split())==1 and d.measure(words(label),22,True)>w-10 else 22
        d.text(x,67,words(label),label_size,True,'center',max_width=w-10)
        d.line([(x,header_height+25),(x,legend_top-20)],color='#666666',dashed=True)
    d.rect(xs['control']-6,message_top,12,legend_top-message_top-30,fill='#eeeeee',stroke='#777777',thickness=1)
    for i,msg in enumerate(messages):
        source,target=msg['from'],msg['to']
        if source not in xs or target not in xs:
            raise ValueError(f"{case['id']}: participante no definido {source}->{target}")
        x1,x2=xs[source],xs[target];y=message_top+i*72
        action=words(captions[i]).split()[0]
        if source==target:
            d.line([(x1,y+32),(x1+75,y+32),(x1+75,y+55),(x1,y+55)],arrow=True)
            d.text(x1+10,y-2,f'{i+1}. {action}',21,max_width=190,background=True)
        else:
            returning=nodes.index(source)>nodes.index(target)
            d.line([(x1,y+38),(x2,y+38)],arrow=True,dashed=returning)
            d.text((x1+x2)/2,y+5,f'{i+1}. {action}',21,anchor='center',background=True)
    d.text(35,legend_top,'Mensajes de la colaboración',23,True)
    yy=legend_top+40
    for lines in legend:
        d.text(35,yy,'\n'.join(lines),22);yy+=len(lines)*29+7
    return d.save(path)


def graph_boxes(title,nodes,relations,path,model=False):
    # Dos columnas dejan una calle central exclusiva para conectores ortogonales.
    widths=480;row_step=365
    layout={node['name']:(25 if i%2==0 else 755,65+(i//2)*row_step) for i,node in enumerate(nodes)}
    helper=Drawing(1260,10)
    legend=[]
    for i,r in enumerate(relations):
        a=r.get('from',r.get('parent'));b=r.get('to',r.get('child'))
        label=r.get('label') or r.get('child_key','relación')
        cardinality=(' ['+r.get('cardinality','')+']') if model else ''
        legend.append(helper.wrap(f'R{i+1}  {a} → {b}{cardinality}: {label}',1190,21))
    legend_height=40+sum(len(lines)*28+9 for lines in legend)
    h=max(500,65+math.ceil(len(nodes)/2)*row_step+legend_height)
    d=Drawing(1260,h);bounds={}
    for node in nodes:
        x,y=layout[node['name']];attrs=node.get('attributes',[]);ops=node.get('operations',[])
        title_lines=d.wrap(node['name'],widths-22,25,True)
        head_h=20+len(title_lines)*32
        body=[]
        for a in attrs:
            body.extend(d.wrap(a,widths-24,22))
        op_lines=[]
        for o in ops:op_lines.extend(d.wrap(o,widths-24,22))
        bh=head_h+20+len(body)*29+(len(op_lines)*29+15 if op_lines else 0)
        if bh>row_step-35: raise ValueError(f"Caja excesiva {node['name']} {bh}")
        d.rect(x,y,widths,bh);d.rect(x,y,widths,head_h,fill='#eeeeee')
        d.text(x+widths/2,y+9,'\n'.join(title_lines),25,True,'center')
        yy=y+head_h+10
        for a in body:d.text(x+12,yy,a,22);yy+=29
        if op_lines:
            d.line([(x,yy+1),(x+widths,yy+1)]);yy+=12
            for o in op_lines:d.text(x+12,yy,o,22);yy+=29
        bounds[node['name']]=(x,y,widths,bh)
    ports={name:[] for name in bounds}
    for i,r in enumerate(relations):
        a=r.get('from',r.get('parent'));b=r.get('to',r.get('child'))
        if a in bounds and b in bounds:
            ports[a].append((i,'from'));ports[b].append((i,'to'))
    positions={}
    for name,items in ports.items():
        x,y,w,hbox=bounds[name]
        for j,item in enumerate(items):positions[item]=y+25+(hbox-50)*(j+.5)/len(items)
    labels=[]
    for i,r in enumerate(relations):
        a=r.get('from',r.get('parent'));b=r.get('to',r.get('child'))
        if a not in bounds or b not in bounds:continue
        ax,ay,aw,ah=bounds[a];bx,by,bw,bh=bounds[b]
        sy=positions[(i,'from')];ty=positions[(i,'to')]
        if ax==bx:
            edge=ax+aw if ax<500 else ax
            lane=545+(i%6)*26 if ax<500 else 720-(i%6)*26
            pts=[(edge,sy),(lane,sy),(lane,ty),(edge,ty)]
        else:
            sx=ax+aw if ax<bx else ax;tx=bx if ax<bx else bx+bw
            lane=540+(i%7)*27
            pts=[(sx,sy),(lane,sy),(lane,ty),(tx,ty)]
        d.line(pts,arrow=not model)
        card=r.get('cardinality','1 -> 0..N').split(' -> ')
        labels.extend([
            (pts[0][0]+(10 if ax<500 else -10),sy+7,card[0] if model else '',18,False,'left' if ax<500 else 'right'),
            (pts[-1][0]+(-10 if bx>500 else 10),ty+7,card[-1] if model else '',18,False,'right' if bx>500 else 'left'),
            (((lane+pts[-1][0])/2 if not model and ay==by and ax<bx else pts[0][0]+(57 if ax<500 else -57)),
             (ty-28 if not model and ay==by and ax<bx else sy-24),f'R{i+1}',18,True,
             ('center' if not model and ay==by and ax<bx else 'left' if ax<500 else 'right')),
        ])
    # Rotular después de todas las rutas evita que una rama posterior cruce texto.
    for x,y,text,size,bold,anchor in labels:d.text(x,y,text,size,bold,anchor,background=True)
    yy=h-legend_height+12
    for lines in legend:
        d.text(30,yy,'\n'.join(lines),21);yy+=len(lines)*28+9
    return d.save(path)


def use_cases(cases,path,title):
    def role(value):
        lowered=value.lower()
        for part,name in [('operador','Operadora plataforma'),('operador','Operadora plataforma'),('admin','Administradora'),('propietaria','Administradora'),('vendedor','Vendedora'),('analista','Analista'),('client','Compradora'),('comprador','Compradora')]:
            if part in lowered:return name
        return value
    roles=list(dict.fromkeys(role(c['actor']) for c in cases))
    h=max(150+len(cases)*118,260+len(roles)*260);d=Drawing(1260,h)
    role_y={name:150+(i+0.5)*(h-260)/len(roles) for i,name in enumerate(roles)}
    for name,y in role_y.items(): actor(d,110,y,name)
    d.rect(300,30,920,h-60,fill='white')
    d.text(760,45,title,27,True,'center')
    for i,c in enumerate(cases):
        y=110+i*118
        d.line([(150,role_y[role(c['actor'])]),(340,y+40)])
        d.ellipse(350,y,820,92)
        d.text(760,y+16,c['id']+' '+c['title'],24,anchor='center',max_width=770)
    return d.save(path)


def state_diagram(title,states,transitions,path):
    nodes=[{'name':s,'attributes':[],'operations':[]} for s in states]
    return graph_boxes(title,nodes,[{'from':a,'to':b,'label':label} for a,b,label in transitions],path)


def qr_code(url,path):
    from reportlab.graphics.barcode.qr import QrCodeWidget
    qr=QrCodeWidget(url);qr.qr.make();matrix=qr.qr.modules
    quiet=4;scale=12;size=(len(matrix)+quiet*2)*scale
    image=Image.new('RGB',(size,size),'white');draw=ImageDraw.Draw(image)
    for y,row in enumerate(matrix):
        for x,value in enumerate(row):
            if value:draw.rectangle(((x+quiet)*scale,(y+quiet)*scale,(x+quiet+1)*scale-1,(y+quiet+1)*scale-1),fill='black')
    image.save(path);return Path(path)
