import { node } from './theater-dom.js';
import { permits } from './theater-flow.js';

const vector = 'http://www.w3.org/2000/svg';
export const compositions = {
  observatory: ['light', 'sealed'],
  dock: ['hook', 'ramp', 'ready'],
  morning: ['light', 'note', 'knock'],
};

// RC23: generic spaces redrawn with layered, theme-aware fills; four new spaces.
const art = {
  observatory: [
    ['arch', 'M100 190V145Q100 15 300 15T500 145V190Z'],
    ['lines', 'M100 145H500M130 75H470M300 15V145M237 22Q170 70 170 145M363 22Q430 70 430 145'],
    ['sky', 'M171 88l11-24m35 47l10-24m126-12l9-22m60 56l9-22m-153 35 9-20m88 20 8-18'],
    ['shutter', 'M100 190V145Q100 15 300 15T500 145V190ZM100 145H500M300 15V145'],
    ['deck', 'M0 156 600 156V330H0Z'],
    ['lines', 'M0 181H600M0 299H600M200 180v119m200-119v119M15 314H585'],
    ['beam', 'M310 151 28 321H575L330 151Z'],
    ['track', 'M0 258H600M412 247l17 11m-6-11 17 11m-6-11 17 11m-6-11 17 11'],
  ],
  dock: [
    ['water', 'M451 0H600V330H282Q406 261 451 0Z'],
    ['lines waterlines', 'M469 55h87m-108 55h145m-121 61h54m-89 45h113m-172 60h104m-109 34h164'],
    ['wood', 'M0 0H451Q406 261 282 330H0Z'],
    ['lines', 'M0 55h439M0 112h425M0 174h402M0 238h366M0 294h323M24 46h140m-68 86h213m-287 94h130m7 34h177'],
    ['ramp', 'M235 215 534 250 531 280 232 244Z M334 228l-3 29m49-25-3 30m47-25-3 30m48-25-3 31'],
    ['boat', 'M289 218q68-43 151 5l-25 44h-98z M314 234l104 5m-92 13 84 4'],
    ['hook', 'M225 183q31 40 79 40m-21-13 21 13-17 9'],
  ],
  morning: [
    ['wall', 'M0 0H600V243H0Z'],
    ['window', 'M262 21H526V195H262Z'],
    ['lines', 'M272 33H516V181H272Z M394 33v148m-122-72h244M248 196h291'],
    ['curtain', 'M262 23H395V188q-45 11-133-1z M278 25v152m24-152v152m24-152v152m23-152v154m24-154v152'],
    ['curtain right', 'M395 23H526V187q-72 12-131 1z M416 27v150m22-150v150m23-150v150m21-150v150m23-150v150'],
    ['beam', 'M293 122H520L600 330H49Z'],
    ['floor', 'M0 242H600V330H0Z'],
    ['bed', 'M0 214Q16 162 93 180l129 37 60 71H0Z M0 228l247 27M21 214l82 20 42-18-81-21z'],
    ['table', 'M331 252h145v61H331z M334 262h139m-86 15h34'],
    ['note', 'M370 249l33-13 36 10-32 13z M392 246l18-5m-13 8 17-5'],
    ['knock', 'M469 99q27 15 0 29m10-40q41 23 0 51m11-65q56 34 0 78'],
  ],
  room: [['wall','M0 0H600V214H0Z'],['trim','M0 178H600V214H0Z'],['lines','M0 186H600M0 206H600'],['glass','M396 34H548V146H396Z'],['lines','M472 34V146M396 90H548M384 152H560'],['shade','M396 34H548V58H396Z'],['frame','M66 52H170V128H66Z'],['lines','M80 66H156V114H80Z'],['floor','M0 214H600V330H0Z'],['lines','M0 252H600M0 296H600M120 214l-40 116M300 214v116M480 214l40 116'],['rug','M170 244H430L470 312H130Z'],['lines','M186 254H414M164 302H436']],
  bench: [['desk','M0 0H600V330H0Z'],['lines grain','M0 38Q150 30 300 40T600 34M0 118Q160 110 330 122T600 112M0 214Q140 206 290 218T600 208M0 300Q170 292 340 304T600 296'],['mat','M118 70H482V262H118Z'],['lines grid','M118 118H482M118 166H482M118 214H482M209 70V262M300 70V262M391 70V262'],['trim','M30 18H250V40H30Z'],['lines','M50 18v9m22-9v14m22-14v9m22-9v14m22-14v9m22-9v14m22-14v9m22-9v14'],['shade','M0 310H600V330H0Z']],
  garden: [['sky','M0 0H600V150H0Z'],['hedge','M0 150Q40 112 84 136T170 128T260 140T352 124T440 138T528 122T600 134V196H0Z'],['grass','M0 190H600V330H0Z'],['lines','M0 214Q150 204 300 216T600 208'],['stone','M264 300h72l10 22h-92z M276 252h52l7 16h-66z M286 214h34l5 11h-44z'],['lines fence','M30 150v52M70 150v52M110 150v52M490 150v52M530 150v52M570 150v52M18 164H122M478 164H582M18 186H122M478 186H582']],
  control: [['panel','M0 0H600V160H0Z'],['screen','M40 26H190V112H40Z M226 18H374V120H226Z M410 26H560V112H410Z'],['lines','M54 90l26-24 22 14 32-34 30 22M240 40h120M240 60h86M240 80h108M240 100h60M424 98h28v-24h28v-30h28v16h28'],['trim','M0 132H600V160H0Z'],['console','M0 160H600V330H0Z'],['slope','M0 160H600L570 214H30Z'],['lines','M70 186h40m40 0h40m40 0h40m40 0h40m40 0h40M20 252H580M20 296H580M150 252v44M300 252v44M450 252v44']],
  street: [['sky','M0 0H600V120H0Z'],['facade','M0 30H210V250H0Z M390 10H600V250H390Z'],['glass','M24 60H84V120H24Z M118 60H178V120H118Z M24 150H84V210H24Z M414 40H474V100H414Z M510 40H570V100H510Z M414 130H474V190H414Z M510 130H570V190H510Z'],['trim','M210 196H390V250H210Z'],['lines','M240 196V250M270 196V250M300 196V250M330 196V250M360 196V250'],['shade','M118 150H178V250H118Z'],['floor','M0 250H600V330H0Z'],['lines','M0 268H600M150 330l40-80M300 330v-80M450 330l-40-80M60 290h40m80 0h40m80 0h40m80 0h40m80 0h40'],['lines','M300 120v76M290 120h20']],
  study: [['wall','M0 0H600V230H0Z'],['shelf','M24 20H210V230H24Z M390 20H576V230H390Z'],['lines','M24 82H210M24 150H210M390 82H576M390 150H576'],['book','M36 36h14v46H36z M52 44h12v38H52z M66 32h16v50H66z M90 40h12v42H90z M104 36h18v46h-18z M40 100h18v50H40z M62 108h12v42H62z M80 98h16v52H80z M404 36h16v46h-16z M424 42h12v40h-12z M440 34h18v48h-18z M470 44h12v38h-12z M408 104h14v46h-14z M426 98h18v52h-18z M450 108h12v42h-12z M500 100h16v50h-16z'],['glass','M248 40H352V150H248Z'],['lines','M300 40V150M248 95H352'],['floor','M0 230H600V330H0Z'],['desk','M150 244H450V280H150Z'],['lines','M170 280v40M430 280v40']],
  shop: [['wall','M0 0H600V200H0Z'],['awning','M0 0H600V34H0Z'],['lines','M50 0v34M100 0v34M150 0v34M200 0v34M250 0v34M300 0v34M350 0v34M400 0v34M450 0v34M500 0v34M550 0v34'],['shelf','M30 54H570V170H30Z'],['lines','M30 112H570M165 54V170M300 54V170M435 54V170'],['jar','M50 82h30v30H50z M92 88h24v24H92z M130 78h22v34h-22z M186 84h34v28h-34z M232 90h26v22h-26z M320 78h30v34h-30z M362 86h28v26h-28z M456 82h36v30h-36z M506 88h28v24h-28z M60 136h40v34H60z M196 130h30v40h-30z M344 138h38v32h-38z M480 132h34v38h-34z'],['counter','M0 200H600V330H0Z'],['trim','M0 200H600V226H0Z'],['lines','M150 226v104M300 226v104M450 226v104']],
  wild: [['sky','M0 0H600V170H0Z'],['hill','M0 170Q120 96 240 150T460 120T600 140V230H0Z'],['tree','M40 230V120l-24 34 24-6-30 40 30-6V230 M550 230V100l-26 38 26-6-32 44 32-6V230 M470 230V150l-18 26 18-4-22 30 22-4V230'],['grass','M0 220H600V330H0Z'],['lines','M0 240Q150 230 300 244T600 236M80 300l6-14 6 14m120-30 5-12 5 12m180 40 6-14 6 14m90-60 5-12 5 12'],['water','M330 330Q350 280 420 268T600 256V330Z']],
};

export function scenery(grid, module, state, finished) {
  const scene = node(grid, 'div', 'ct-scene');
  const view = module.view || module.space;
  scene.dataset.view = view;
  scene.dataset.finish = String(finished);
  for (const [key, condition] of Object.entries(module.cues ?? {})) {
    if (permits(state, { need: [], when: [condition] })) scene.dataset[key] = 'true';
  }
  const svg = grid.ownerDocument.createElementNS(vector, 'svg');
  svg.setAttribute('class', 'ct-backdrop');
  svg.setAttribute('viewBox', '0 0 600 330');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');
  for (const [layer, path] of art[view]) {
    const shape = grid.ownerDocument.createElementNS(vector, 'path');
    shape.setAttribute('class', layer);
    shape.setAttribute('d', path);
    svg.append(shape);
  }
  scene.append(svg, grid);
  return scene;
}
