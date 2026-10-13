'use strict';
// Mi armario: prendas con foto, looks que las combinan y una propuesta para hoy.
// Las fotos van en IndexedDB; en localStorage solo la pestaña abierta.

const TIPOS = [['arriba', 'Arriba', '👕'], ['abajo', 'Abajo', '👖'], ['vestido', 'Vestidos', '👗'], ['abrigo', 'Abrigos', '🧥'], ['calzado', 'Calzado', '👟'], ['accesorio', 'Accesorios', '👜']];
const OCASIONES = ['Diario', 'Trabajo', 'Salir', 'Deporte', 'Casa'];
const TIEMPOS = [['calor', 'Calor', '☀️'], ['entre', 'Entretiempo', '🍂'], ['frio', 'Frío', '❄️']];
const ORDEN_TIPO = Object.fromEntries(TIPOS.map((t, i) => [t[0], i]));
const DIAS_SEM = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const hoyISO = () => iso(new Date());
const diasDesde = f => Math.round((new Date(hoyISO() + 'T12:00') - new Date(f + 'T12:00')) / 864e5);

// ---------- Guardado ----------
const DB = (() => {
  let abierta;
  const abrir = () => abierta || (abierta = new Promise((ok, ko) => {
    const r = indexedDB.open('mi-armario', 1);
    r.onupgradeneeded = () => { r.result.createObjectStore('prendas', { keyPath: 'id' }); r.result.createObjectStore('looks', { keyPath: 'id' }); };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => ko(r.error);
  }));
  const tx = async (almacen, modo, fn) => {
    const db = await abrir();
    return new Promise((ok, ko) => {
      const t = db.transaction(almacen, modo);
      const req = fn(t.objectStore(almacen));
      t.oncomplete = () => ok(req && req.result);
      t.onerror = () => ko(t.error);
      t.onabort = () => ko(t.error);
    });
  };
  return {
    todo: a => tx(a, 'readonly', s => s.getAll()),
    poner: (a, v) => tx(a, 'readwrite', s => s.put(v)),
    quitar: (a, id) => tx(a, 'readwrite', s => s.delete(id)),
    vaciar: a => tx(a, 'readwrite', s => s.clear())
  };
})();

let pref = {};
try { pref = JSON.parse(localStorage.getItem('mi-armario-pref')) || {}; } catch (e) {}
const guardaPref = () => { try { localStorage.setItem('mi-armario-pref', JSON.stringify(pref)); } catch (e) {} };

const S = { prendas: [], looks: [], vista: pref.vista || 'hoy', tipo: 'todo', oc: '', tiempo: '', sug: null, cambiando: false, nuevas: [], ed: null, error: '' };

let persistido = false;
function pedirPersistencia() {
  if (persistido) return;
  persistido = true;
  try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) {}
}
async function guardar(almacen, v) {
  try { await DB.poner(almacen, v); pedirPersistencia(); }
  catch (e) { aviso('No se ha podido guardar. Puede que el móvil esté sin espacio.'); throw e; }
}

// ---------- Fotos ----------
const urls = new Map();
function fotoURL(clave, blob) {
  if (!blob) return '';
  let u = urls.get(clave);
  if (!u || u.blob !== blob) { if (u) URL.revokeObjectURL(u.url); u = { blob, url: URL.createObjectURL(blob) }; urls.set(clave, u); }
  return u.url;
}
function olvidarFoto(clave) { const u = urls.get(clave); if (u) { URL.revokeObjectURL(u.url); urls.delete(clave); } }

function cargarImagen(file) {
  return new Promise((ok, ko) => {
    const u = URL.createObjectURL(file), i = new Image();
    i.onload = () => { URL.revokeObjectURL(u); ok(i); };
    i.onerror = () => { URL.revokeObjectURL(u); ko(new Error('imagen')); };
    i.src = u;
  });
}
async function comprimir(file, max = 900) {
  const im = await cargarImagen(file);
  const k = Math.min(1, max / Math.max(im.naturalWidth, im.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(im.naturalWidth * k));
  c.height = Math.max(1, Math.round(im.naturalHeight * k));
  c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
  return new Promise(ok => c.toBlob(b => ok(b || file), 'image/jpeg', .82));
}

// ---------- Datos ----------
const prenda = id => S.prendas.find(p => p.id === id);
const look = id => S.looks.find(l => l.id === id);
const tipoDe = t => TIPOS.find(x => x[0] === t) || TIPOS[0];
const ultimoUso = l => (l.usos || []).reduce((m, f) => f > m ? f : m, '');
const prendasDe = l => (l.prendas || []).map(prenda).filter(Boolean).sort((a, b) => ORDEN_TIPO[a.tipo] - ORDEN_TIPO[b.tipo]);
const looksCon = id => S.looks.filter(l => (l.prendas || []).includes(id));
const nombreLook = l => l.nombre || 'Look sin nombre';

function hace(f) {
  const d = diasDesde(f);
  return d <= 0 ? 'hoy' : d === 1 ? 'ayer' : d < 7 ? `hace ${d} días` : d < 14 ? 'hace una semana' : d < 60 ? `hace ${Math.round(d / 7)} semanas` : `hace ${Math.round(d / 30)} meses`;
}
function metaLook(l) {
  const n = (l.usos || []).length, u = ultimoUso(l);
  if (!n) return 'Aún no te lo has puesto';
  return `Puesto ${hace(u)} · ${n === 1 ? 'una vez' : n + ' veces'}`;
}

function collage(l, cls = '') {
  if (l.foto) return `<div class="collage ${cls}"><img src="${fotoURL('L' + l.id, l.foto)}" alt=""></div>`;
  const ps = prendasDe(l).slice(0, 4);
  if (!ps.length) return `<div class="collage vacio ${cls}">👗</div>`;
  return `<div class="collage n${ps.length} ${cls}">${ps.map(p => `<img src="${fotoURL(p.id, p.foto)}" alt="">`).join('')}</div>`;
}
const fotoPrenda = p => `<div class="foto"><img src="${fotoURL(p.id, p.foto)}" alt="${esc(p.nombre || tipoDe(p.tipo)[1])}" loading="lazy"></div>`;

// ---------- Propuesta del día ----------
const encaja = l => (!S.oc || !(l.ocasiones || []).length || l.ocasiones.includes(S.oc)) && (!S.tiempo || !(l.tiempos || []).length || l.tiempos.includes(S.tiempo));
function elegir(excluir) {
  let c = S.looks.filter(encaja);
  if (c.length > 1 && excluir) c = c.filter(l => l.id !== excluir);
  if (!c.length) return null;
  const pesos = c.map(l => { const u = ultimoUso(l); const d = u ? diasDesde(u) : 21; return Math.max(.4, Math.min(d, 30)) * (l.fav ? 2 : 1); });
  let r = Math.random() * pesos.reduce((a, b) => a + b, 0);
  for (let i = 0; i < c.length; i++) { r -= pesos[i]; if (r <= 0) return c[i].id; }
  return c[c.length - 1].id;
}

// ---------- Vistas ----------
function render() {
  document.querySelectorAll('.tabs button').forEach(b => b.setAttribute('aria-current', b.dataset.val === S.vista ? 'page' : 'false'));
  $('#vista').innerHTML = S.error ? `<div class="tarjeta vacio-txt"><span class="grande">🙈</span>${esc(S.error)}</div>`
    : S.vista === 'looks' ? vLooks() : S.vista === 'prendas' ? vPrendas() : vHoy();
}

const chipsFiltro = () => `<div class="filtros">
  <div class="chips">${['', ...OCASIONES].map(o => `<button class="chip${S.oc === o ? ' on' : ''}" data-acc="oc" data-val="${o}">${o || 'Cualquier plan'}</button>`).join('')}</div>
  <div class="chips">${[['', 'Da igual', '🌤️'], ...TIEMPOS].map(([k, n, e]) => `<button class="chip${S.tiempo === k ? ' on' : ''}" data-acc="tiempo" data-val="${k}">${e} ${n}</button>`).join('')}</div>
</div>`;

function vHoy() {
  const h = new Date().getHours();
  const saludo = h < 6 ? 'Buenas noches' : h < 14 ? 'Buenos días' : h < 21 ? 'Buenas tardes' : 'Buenas noches';
  if (!S.looks.length) {
    return `<div class="saludo"><h2>${saludo}</h2><p>Monta tu armario una vez y cada mañana elige en un toque.</p></div>
    <ol class="pasos">
      <li><b>1</b><div><strong>Fotografía tus prendas</strong><span>Una foto de cada cosa que tienes en casa.${S.prendas.length ? ` Llevas ${S.prendas.length}.` : ''}</span></div></li>
      <li><b>2</b><div><strong>Combínalas en looks</strong><span>Junta las que sabes que quedan bien.</span></div></li>
      <li><b>3</b><div><strong>Elige sin pensar</strong><span>Cada día te propongo uno de tus looks.</span></div></li>
    </ol>
    <button class="btn ancho" data-acc="${S.prendas.length ? 'nuevo-look' : 'add-prendas'}">${S.prendas.length ? 'Crear mi primer look' : 'Añadir prendas'}</button>`;
  }
  const hoy = hoyISO();
  const puesto = S.looks.find(l => (l.usos || []).includes(hoy));
  let html = `<div class="saludo"><h2>${saludo}</h2><p>${puesto && !S.cambiando ? 'Hoy ya lo tienes decidido.' : '¿Qué te pones hoy?'}</p></div>`;

  if (puesto && !S.cambiando) {
    html += `<div class="tarjeta puesto">${collage(puesto)}<div><span class="listo">✓ Hoy llevas</span><h3>${esc(nombreLook(puesto))}</h3>
      <div class="fila" style="margin-top:10px"><button class="btn sec" data-acc="ver-look" data-id="${puesto.id}">Ver</button><button class="btn suave" data-acc="cambiar">Cambiar</button></div></div></div>`;
  } else {
    html += chipsFiltro();
    if (!S.sug || !look(S.sug) || !encaja(look(S.sug))) S.sug = elegir();
    const l = S.sug && look(S.sug);
    if (!l) {
      html += `<div class="tarjeta vacio-txt"><span class="grande">🧺</span>Ningún look encaja con estos filtros.<div class="fila" style="margin-top:14px"><button class="btn sec" data-acc="quitar-filtros">Quitar filtros</button><button class="btn" data-acc="nuevo-look">Nuevo look</button></div></div>`;
    } else {
      const otros = S.looks.filter(encaja).length > 1;
      html += `<article class="sug" data-sug="${l.id}">
        <button class="pieza" data-acc="ver-look" data-id="${l.id}" aria-label="Ver look">${collage(l)}</button>
        <div class="sug-info"><span class="etq">Hoy te propongo</span><h3>${esc(nombreLook(l))}</h3><p class="meta">${metaLook(l)}</p>
          <div class="fila">${otros ? '<button class="btn sec" data-acc="otro">Otro</button>' : ''}<button class="btn" data-acc="ponerme" data-id="${l.id}">Me lo pongo</button></div>
          ${S.cambiando ? '<button class="btn suave" data-acc="no-cambiar" style="margin-top:8px">Dejar el de hoy</button>' : ''}
        </div></article>`;
    }
  }

  const dias = [];
  for (let i = 0; i < 14 && dias.length < 7; i++) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const f = iso(d), l = S.looks.find(x => (x.usos || []).includes(f));
    if (l) dias.push(`<button class="dia" data-acc="ver-look" data-id="${l.id}">${collage(l)}<span>${i === 0 ? 'Hoy' : i === 1 ? 'Ayer' : DIAS_SEM[d.getDay()] + ' ' + d.getDate()}</span></button>`);
  }
  if (dias.length) html += `<section class="bloque"><h2>Lo último que te has puesto</h2><div class="dias">${dias.join('')}</div></section>`;
  return html;
}

function vLooks() {
  const lista = S.looks.filter(encaja).sort((a, b) => (b.fav ? 1 : 0) - (a.fav ? 1 : 0) || b.creado - a.creado);
  return `<div class="cab"><h2>Tus looks</h2><span>${S.looks.length}</span></div>
  ${S.looks.length ? chipsFiltro() : ''}
  <div class="rejilla">
    <button class="pieza" data-acc="nuevo-look"><span class="nuevo"><span class="mas">+</span>Nuevo look</span></button>
    ${lista.map(l => `<button class="pieza" data-acc="ver-look" data-id="${l.id}">${collage(l)}${l.fav ? '<span class="cora">❤️</span>' : ''}<strong>${esc(nombreLook(l))}</strong><small>${(l.usos || []).length ? metaLook(l).replace('Puesto ', '') : 'Sin estrenar'}</small></button>`).join('')}
  </div>
  ${S.looks.length && !lista.length ? '<p class="vacio-txt">Ningún look encaja con estos filtros.</p>' : ''}
  ${!S.prendas.length ? '<p class="nota">Primero añade algunas prendas en la pestaña Prendas, o crea un look con una foto tuya puesto.</p>' : ''}`;
}

function vPrendas() {
  const n = t => S.prendas.filter(p => t === 'todo' || p.tipo === t).length;
  const lista = S.prendas.filter(p => S.tipo === 'todo' || p.tipo === S.tipo).sort((a, b) => ORDEN_TIPO[a.tipo] - ORDEN_TIPO[b.tipo] || b.creado - a.creado);
  return `<div class="cab"><h2>Tus prendas</h2><span>${S.prendas.length}</span></div>
  <div class="chips" style="margin-bottom:16px">
    <button class="chip${S.tipo === 'todo' ? ' on' : ''}" data-acc="tipo" data-val="todo">Todo<small>${n('todo')}</small></button>
    ${TIPOS.map(([k, nom, e]) => `<button class="chip${S.tipo === k ? ' on' : ''}" data-acc="tipo" data-val="${k}">${e} ${nom}<small>${n(k)}</small></button>`).join('')}
  </div>
  <div class="rejilla prendas">
    <button class="pieza" data-acc="add-prendas"><span class="nuevo"><span class="mas">+</span>Añadir</span></button>
    ${lista.map(p => `<button class="pieza" data-acc="ver-prenda" data-id="${p.id}">${fotoPrenda(p)}${p.nombre ? `<span class="nom">${esc(p.nombre)}</span>` : ''}</button>`).join('')}
  </div>
  ${!S.prendas.length ? '<p class="nota">Haz fotos a tu ropa sobre la cama o colgada. Puedes elegir varias fotos a la vez.</p>' : ''}
  <section class="copia tarjeta">
    <h3>Tus fotos viven en este móvil</h3>
    <p class="nota" style="margin:0">No se suben a ningún sitio. Descarga una copia de vez en cuando para no perderlas o para pasarlas a otro móvil.</p>
    <div class="fila"><button class="btn sec" data-acc="exportar">Descargar copia</button><button class="btn suave" data-acc="importar">Cargar copia</button></div>
  </section>`;
}

// ---------- Hojas ----------
let hojaAbierta = false;
function abrirHoja(titulo, cuerpo, pie = '') {
  $('#hoja').innerHTML = `<div class="hoja-cab"><h3>${titulo}</h3><button class="cerrar" data-acc="cerrar" aria-label="Cerrar">×</button></div>${cuerpo}${pie ? `<div class="hoja-pie">${pie}</div>` : ''}`;
  $('#hoja').scrollTop = 0;
  if (!hojaAbierta) {
    hojaAbierta = true;
    $('#velo').hidden = false;
    try { if (!(history.state && history.state.hoja)) history.pushState({ hoja: 1 }, ''); } catch (e) {}
    requestAnimationFrame(() => requestAnimationFrame(() => document.body.classList.add('con-hoja')));
  }
}
function cerrarDeVerdad() {
  if (!hojaAbierta) return;
  hojaAbierta = false;
  document.body.classList.remove('con-hoja');
  S.ed = null; S.nuevas = [];
  setTimeout(() => { if (!hojaAbierta) { $('#velo').hidden = true; $('#hoja').innerHTML = ''; } }, 260);
}
function cerrarHoja() {
  if (history.state && history.state.hoja) history.back(); else cerrarDeVerdad();
}
window.addEventListener('popstate', cerrarDeVerdad);

function hojaPrenda(id) {
  const p = prenda(id); if (!p) return;
  const ls = looksCon(id);
  abrirHoja(esc(p.nombre || tipoDe(p.tipo)[1]), `
    <div class="grande-foto"><img src="${fotoURL(p.id, p.foto)}" alt=""></div>
    <label class="campo"><span>Nombre</span><input type="text" id="p-nombre" value="${esc(p.nombre)}" placeholder="Camisa blanca de lino" maxlength="60"></label>
    <div class="campo"><span>Tipo</span><div class="chips" data-grupo="p-tipo">${TIPOS.map(([k, n, e]) => `<button class="chip${p.tipo === k ? ' on' : ''}" data-acc="uno" data-val="${k}">${e} ${n}</button>`).join('')}</div></div>
    <div class="campo"><span>${ls.length ? `Está en ${ls.length === 1 ? 'un look' : ls.length + ' looks'}` : 'Aún no está en ningún look'}</span>
      ${ls.length ? `<div class="tira">${ls.map(l => `<button data-acc="ver-look" data-id="${l.id}">${collage(l)}</button>`).join('')}</div>` : ''}
      <button class="btn sec" data-acc="nuevo-look" data-id="${p.id}">Crear un look con ella</button></div>
    <button class="btn peligro ancho" data-acc="borrar-prenda" data-id="${p.id}">Borrar prenda</button>`,
    `<button class="btn" data-acc="guardar-prenda" data-id="${p.id}">Guardar</button>`);
}

function hojaLook(id) {
  const l = look(id); if (!l) return;
  const ps = prendasDe(l), hoy = hoyISO(), hoyPuesto = (l.usos || []).includes(hoy);
  const marcas = [...(l.ocasiones || []), ...(l.tiempos || []).map(t => { const x = TIEMPOS.find(y => y[0] === t); return x ? x[2] + ' ' + x[1] : ''; })].filter(Boolean);
  abrirHoja(esc(nombreLook(l)), `
    ${collage(l, 'grande')}
    <p class="meta" style="margin-top:12px">${metaLook(l)}</p>
    ${marcas.length ? `<div class="marcas">${marcas.map(m => `<span>${esc(m)}</span>`).join('')}</div>` : ''}
    ${ps.length ? `<div class="campo"><span>Prendas</span><div class="tira">${ps.map(p => `<button data-acc="ver-prenda" data-id="${p.id}">${fotoPrenda(p)}</button>`).join('')}</div></div>` : ''}
    <div class="fila" style="margin:14px 0 10px"><button class="btn sec" data-acc="fav" data-id="${l.id}">${l.fav ? '❤️ Favorito' : '🤍 Favorito'}</button><button class="btn sec" data-acc="editar-look" data-id="${l.id}">Editar</button></div>
    <button class="btn peligro ancho" data-acc="borrar-look" data-id="${l.id}">Borrar look</button>`,
    hoyPuesto ? `<button class="btn sec" data-acc="quitar-hoy" data-id="${l.id}">No me lo pongo hoy</button>` : `<button class="btn" data-acc="ponerme" data-id="${l.id}">Me lo pongo hoy</button>`);
}

function hojaEditor() {
  const e = S.ed, nuevo = !look(e.id);
  abrirHoja(nuevo ? 'Nuevo look' : 'Editar look', `
    <label class="campo"><span>Nombre</span><input type="text" id="ed-nombre" value="${esc(e.nombre)}" placeholder="Vaqueros y jersey crudo" maxlength="60"></label>
    <div class="campo"><span>Prendas <span class="cuenta" id="ed-cuenta">${e.prendas.length ? e.prendas.length + ' elegidas' : ''}</span></span>
      ${S.prendas.length ? `<div class="chips" data-grupo="ed-tipo">${[['todo', 'Todo', ''], ...TIPOS].map(([k, n, em]) => `<button class="chip${e.tipo === k ? ' on' : ''}" data-acc="ed-tipo" data-val="${k}">${em ? em + ' ' : ''}${n}</button>`).join('')}</div>
      <div class="selector" id="ed-sel">${selector()}</div>` : '<p class="nota" style="margin:0">Aún no tienes prendas. Puedes guardar el look solo con una foto tuya puesto.</p>'}
    </div>
    <div class="campo"><span>Foto del look puesto, si quieres</span><div class="foto-look" id="ed-foto">${bloqueFotoLook()}</div></div>
    <div class="campo"><span>Para</span><div class="chips">${OCASIONES.map(o => `<button class="chip${e.ocasiones.includes(o) ? ' on' : ''}" data-acc="ed-oc" data-val="${o}">${o}</button>`).join('')}</div></div>
    <div class="campo"><span>Tiempo</span><div class="chips">${TIEMPOS.map(([k, n, em]) => `<button class="chip${e.tiempos.includes(k) ? ' on' : ''}" data-acc="ed-tiempo" data-val="${k}">${em} ${n}</button>`).join('')}</div></div>
    <p class="nota">Si no marcas nada en Para o Tiempo, el look vale para todo.</p>`,
    `<button class="btn suave" data-acc="cerrar">Cancelar</button><button class="btn" data-acc="guardar-look">Guardar look</button>`);
}
function selector() {
  const e = S.ed;
  const lista = S.prendas.filter(p => e.tipo === 'todo' || p.tipo === e.tipo).sort((a, b) => ORDEN_TIPO[a.tipo] - ORDEN_TIPO[b.tipo] || b.creado - a.creado);
  if (!lista.length) return '<p class="nota" style="grid-column:1/-1;margin:0">No hay prendas de este tipo.</p>';
  return lista.map(p => `<button class="sel-p${e.prendas.includes(p.id) ? ' on' : ''}" data-acc="ed-prenda" data-id="${p.id}" aria-pressed="${e.prendas.includes(p.id)}">${fotoPrenda(p)}</button>`).join('');
}
function bloqueFotoLook() {
  const e = S.ed;
  return e.foto ? `<div class="foto"><img src="${fotoURL('ED', e.foto)}" alt=""></div><div class="fila"><button class="btn sec" data-acc="ed-foto">Cambiar</button><button class="btn suave" data-acc="ed-quitar-foto">Quitar</button></div>`
    : `<button class="btn sec" data-acc="ed-foto">Añadir foto</button>`;
}

function hojaNuevas() {
  abrirHoja(S.nuevas.length === 1 ? 'Nueva prenda' : `${S.nuevas.length} prendas nuevas`,
    `<p class="nota" style="margin-top:0">Dime qué es cada una. El nombre es opcional.</p>` +
    S.nuevas.map((n, i) => `<div class="nueva"><div class="foto"><img src="${fotoURL('N' + i, n.foto)}" alt=""></div><div>
      <input type="text" data-i="${i}" class="n-nombre" value="${esc(n.nombre)}" placeholder="Nombre" maxlength="60">
      <div class="chips">${TIPOS.map(([k, nom, e]) => `<button class="chip${n.tipo === k ? ' on' : ''}" data-acc="n-tipo" data-i="${i}" data-val="${k}">${e} ${nom}</button>`).join('')}</div>
    </div></div>`).join(''),
    `<button class="btn" data-acc="guardar-nuevas">${S.nuevas.length === 1 ? 'Guardar prenda' : `Guardar ${S.nuevas.length} prendas`}</button>`);
}

// ---------- Avisos y confirmaciones ----------
let tAviso;
function aviso(txt) {
  const a = $('#aviso');
  a.textContent = txt; a.hidden = false;
  a.style.animation = 'none'; void a.offsetWidth; a.style.animation = '';
  clearTimeout(tAviso); tAviso = setTimeout(() => { a.hidden = true; }, 2600);
}
function dobleToque(b, txt, fn) {
  if (b.dataset.armado) { fn(); return; }
  const antes = b.textContent;
  b.dataset.armado = '1'; b.classList.add('armado'); b.textContent = txt;
  setTimeout(() => { if (b.isConnected) { delete b.dataset.armado; b.classList.remove('armado'); b.textContent = antes; } }, 3000);
}

// ---------- Acciones ----------
async function ponerme(id) {
  const hoy = hoyISO();
  for (const l of S.looks) {
    const tenia = (l.usos || []).includes(hoy);
    if (l.id === id && !tenia) { l.usos = [...(l.usos || []), hoy]; await guardar('looks', l); }
    else if (l.id !== id && tenia) { l.usos = l.usos.filter(f => f !== hoy); await guardar('looks', l); }
  }
  S.cambiando = false;
  if (navigator.vibrate) navigator.vibrate(15);
  aviso('Apuntado. ¡Que vaya bonito el día!');
}

function abrirEditor(id, conPrenda) {
  const l = id && look(id);
  S.ed = l ? { id: l.id, nombre: l.nombre || '', prendas: [...(l.prendas || [])], foto: l.foto || null, ocasiones: [...(l.ocasiones || [])], tiempos: [...(l.tiempos || [])], tipo: 'todo' }
    : { id: uid(), nombre: '', prendas: conPrenda ? [conPrenda] : [], foto: null, ocasiones: [], tiempos: [], tipo: 'todo' };
  hojaEditor();
}

const ACC = {
  vista: (b, id, v) => { S.vista = v; pref.vista = v; guardaPref(); render(); window.scrollTo({ top: 0 }); },
  cerrar: () => cerrarHoja(),
  'add-prendas': () => $('#f-prendas').click(),
  tipo: (b, id, v) => { S.tipo = v; render(); },
  oc: (b, id, v) => { S.oc = v; render(); },
  tiempo: (b, id, v) => { S.tiempo = v; render(); },
  'quitar-filtros': () => { S.oc = ''; S.tiempo = ''; render(); },
  otro: () => { S.sug = elegir(S.sug); render(); },
  cambiar: () => { S.cambiando = true; const p = S.looks.find(l => (l.usos || []).includes(hoyISO())); S.sug = elegir(p && p.id); render(); },
  'no-cambiar': () => { S.cambiando = false; render(); },
  ponerme: async (b, id) => { await ponerme(id); if (hojaAbierta) cerrarHoja(); if (S.vista !== 'hoy') { S.vista = 'hoy'; pref.vista = 'hoy'; guardaPref(); } render(); window.scrollTo({ top: 0, behavior: 'smooth' }); },
  'quitar-hoy': async (b, id) => { const l = look(id); l.usos = (l.usos || []).filter(f => f !== hoyISO()); await guardar('looks', l); render(); hojaLook(id); },
  'ver-prenda': (b, id) => hojaPrenda(id),
  'ver-look': (b, id) => hojaLook(id),
  'nuevo-look': (b, id) => abrirEditor(null, id),
  'editar-look': (b, id) => abrirEditor(id),
  fav: async (b, id) => { const l = look(id); l.fav = !l.fav; await guardar('looks', l); render(); hojaLook(id); },
  'borrar-look': (b, id) => dobleToque(b, 'Pulsa otra vez para borrar', async () => {
    await DB.quitar('looks', id); olvidarFoto('L' + id);
    S.looks = S.looks.filter(l => l.id !== id);
    cerrarHoja(); render(); aviso('Look borrado');
  }),
  uno: b => { b.parentNode.querySelectorAll('.chip').forEach(c => c.classList.toggle('on', c === b)); },
  'guardar-prenda': async (b, id) => {
    const p = prenda(id), t = $('#hoja [data-grupo="p-tipo"] .chip.on');
    p.nombre = $('#p-nombre').value.trim(); if (t) p.tipo = t.dataset.val;
    await guardar('prendas', p); cerrarHoja(); render();
  },
  'borrar-prenda': (b, id) => {
    const n = looksCon(id).length;
    dobleToque(b, n ? `Saldrá de ${n === 1 ? 'un look' : n + ' looks'}. Pulsa otra vez` : 'Pulsa otra vez para borrar', async () => {
      for (const l of looksCon(id)) {
        l.prendas = l.prendas.filter(x => x !== id);
        if (!l.prendas.length && !l.foto) { await DB.quitar('looks', l.id); S.looks = S.looks.filter(x => x.id !== l.id); }
        else await guardar('looks', l);
      }
      await DB.quitar('prendas', id); olvidarFoto(id);
      S.prendas = S.prendas.filter(p => p.id !== id);
      cerrarHoja(); render(); aviso('Prenda borrada');
    });
  },
  'n-tipo': (b, id, v) => { S.nuevas[+b.dataset.i].tipo = v; ACC.uno(b); },
  'guardar-nuevas': async b => {
    b.disabled = true;
    const ahora = Date.now();
    for (let i = 0; i < S.nuevas.length; i++) {
      const n = S.nuevas[i], p = { id: uid(), tipo: n.tipo, nombre: n.nombre.trim(), foto: n.foto, creado: ahora + i };
      try { await guardar('prendas', p); } catch (e) { b.disabled = false; return; }
      S.prendas.push(p); olvidarFoto('N' + i);
    }
    const k = S.nuevas.length;
    cerrarHoja(); render(); aviso(k === 1 ? 'Prenda guardada' : `${k} prendas guardadas`);
  },
  'ed-tipo': (b, id, v) => { S.ed.tipo = v; ACC.uno(b); $('#ed-sel').innerHTML = selector(); },
  'ed-prenda': (b, id) => {
    const e = S.ed, i = e.prendas.indexOf(id);
    if (i >= 0) e.prendas.splice(i, 1); else e.prendas.push(id);
    b.classList.toggle('on', i < 0); b.setAttribute('aria-pressed', i < 0);
    $('#ed-cuenta').textContent = e.prendas.length ? e.prendas.length + ' elegidas' : '';
  },
  'ed-oc': (b, id, v) => { const a = S.ed.ocasiones, i = a.indexOf(v); i >= 0 ? a.splice(i, 1) : a.push(v); b.classList.toggle('on', i < 0); },
  'ed-tiempo': (b, id, v) => { const a = S.ed.tiempos, i = a.indexOf(v); i >= 0 ? a.splice(i, 1) : a.push(v); b.classList.toggle('on', i < 0); },
  'ed-foto': () => $('#f-look').click(),
  'ed-quitar-foto': () => { S.ed.foto = null; olvidarFoto('ED'); $('#ed-foto').innerHTML = bloqueFotoLook(); },
  'guardar-look': async b => {
    const e = S.ed;
    e.nombre = $('#ed-nombre').value.trim();
    if (!e.prendas.length && !e.foto) { aviso('Elige al menos una prenda o añade una foto'); return; }
    const antes = look(e.id);
    const l = { id: e.id, nombre: e.nombre, prendas: e.prendas.filter(prenda), foto: e.foto, ocasiones: e.ocasiones, tiempos: e.tiempos, fav: antes ? !!antes.fav : false, usos: antes ? antes.usos || [] : [], creado: antes ? antes.creado : Date.now() };
    b.disabled = true;
    try { await guardar('looks', l); } catch (err) { b.disabled = false; return; }
    if (antes) S.looks[S.looks.indexOf(antes)] = l; else S.looks.push(l);
    olvidarFoto('ED');
    if (!antes) S.sug = l.id;
    cerrarHoja(); render(); aviso(antes ? 'Look guardado' : 'Look creado');
  },
  exportar: () => exportar(),
  importar: () => $('#f-copia').click()
};

document.addEventListener('click', e => {
  const b = e.target.closest('[data-acc]');
  if (!b || b.disabled) return;
  const f = ACC[b.dataset.acc];
  if (f) f(b, b.dataset.id, b.dataset.val, e);
});
$('#velo').addEventListener('click', e => { if (e.target.id === 'velo') cerrarHoja(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && hojaAbierta) cerrarHoja(); });
document.addEventListener('input', e => {
  if (e.target.id === 'ed-nombre' && S.ed) S.ed.nombre = e.target.value;
  if (e.target.classList.contains('n-nombre')) S.nuevas[+e.target.dataset.i].nombre = e.target.value;
});

$('#f-prendas').addEventListener('change', async e => {
  const fs = [...e.target.files]; e.target.value = '';
  if (!fs.length) return;
  aviso(fs.length === 1 ? 'Preparando la foto…' : `Preparando ${fs.length} fotos…`);
  const tipo = S.vista === 'prendas' && S.tipo !== 'todo' ? S.tipo : 'arriba';
  const nuevas = [];
  for (const f of fs) { try { nuevas.push({ foto: await comprimir(f), tipo, nombre: '' }); } catch (err) {} }
  $('#aviso').hidden = true;
  if (!nuevas.length) { aviso('No se ha podido leer la foto'); return; }
  S.nuevas.forEach((n, i) => olvidarFoto('N' + i));
  S.nuevas = nuevas;
  hojaNuevas();
});
$('#f-look').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f || !S.ed) return;
  try { S.ed.foto = await comprimir(f, 1100); $('#ed-foto').innerHTML = bloqueFotoLook(); }
  catch (err) { aviso('No se ha podido leer la foto'); }
});

// ---------- Copia de seguridad ----------
const aDatos = b => new Promise((ok, ko) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = ko; r.readAsDataURL(b); });
const aBlob = d => fetch(d).then(r => r.blob());
async function exportar() {
  aviso('Preparando la copia…');
  const datos = {
    app: 'mi-armario', v: 1, fecha: new Date().toISOString(),
    prendas: await Promise.all(S.prendas.map(async p => ({ ...p, foto: p.foto ? await aDatos(p.foto) : null }))),
    looks: await Promise.all(S.looks.map(async l => ({ ...l, foto: l.foto ? await aDatos(l.foto) : null })))
  };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(datos)], { type: 'application/json' }));
  a.download = `mi-armario-${hoyISO()}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  aviso('Copia descargada');
}
$('#f-copia').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    if (d.app !== 'mi-armario' || !Array.isArray(d.prendas) || !Array.isArray(d.looks)) throw new Error('formato');
    if ((S.prendas.length || S.looks.length) && !confirm(`La copia tiene ${d.prendas.length} prendas y ${d.looks.length} looks. Sustituirá lo que tienes ahora. ¿Seguimos?`)) return;
    aviso('Cargando la copia…');
    const prendas = await Promise.all(d.prendas.map(async p => ({ ...p, foto: p.foto ? await aBlob(p.foto) : null })));
    const looks = await Promise.all(d.looks.map(async l => ({ ...l, foto: l.foto ? await aBlob(l.foto) : null })));
    await DB.vaciar('prendas'); await DB.vaciar('looks');
    for (const p of prendas) await DB.poner('prendas', p);
    for (const l of looks) await DB.poner('looks', l);
    urls.forEach(u => URL.revokeObjectURL(u.url)); urls.clear();
    S.prendas = prendas; S.looks = looks; S.sug = null;
    pedirPersistencia(); render(); aviso('Copia cargada');
  } catch (err) { aviso('Ese archivo no es una copia de Mi armario'); }
});

// ---------- Inicio ----------
(async () => {
  try {
    [S.prendas, S.looks] = await Promise.all([DB.todo('prendas'), DB.todo('looks')]);
  } catch (e) {
    S.error = 'Este navegador no deja guardar fotos aquí. Si estás en modo incógnito, ábrela en una ventana normal.';
  }
  render();
})();
