/**
 * Tabele de echivalente si transliterare.
 *
 * Aici sta jumatate din valoarea aplicatiei: integratele "imposibil de gasit"
 * sunt de obicei clone est-europene ale unor piese occidentale banale. Nimeni
 * nu are datasheet pentru CDB400E, dar toata lumea are pentru SN7400 -- sunt
 * acelasi cip, fabricat la Microelectronica Bucuresti sub alt nume.
 */

/**
 * Cirilic -> latin, in conventia folosita de literatura pentru piese sovietice.
 * K155ЛА3 tastat cirilic devine K155LA3, care e cautabil pe web.
 */
const CYRILLIC_TRANSLIT: Record<string, string> = {
  А: 'A', Б: 'B', В: 'V', Г: 'G', Д: 'D', Е: 'E', Ж: 'ZH', З: 'Z',
  И: 'I', Й: 'J', К: 'K', Л: 'L', М: 'M', Н: 'N', О: 'O', П: 'P',
  Р: 'R', С: 'S', Т: 'T', У: 'U', Ф: 'F', Х: 'H', Ц: 'C', Ч: 'CH',
  Ш: 'SH', Щ: 'SCH', Ы: 'Y', Э: 'E', Ю: 'YU', Я: 'YA', Ь: '', Ъ: ''
}

export function transliterateCyrillic(input: string): string {
  let out = ''
  for (const ch of input.toUpperCase()) {
    out += CYRILLIC_TRANSLIT[ch] ?? ch
  }
  return out
}

export function hasCyrillic(input: string): boolean {
  return /[Ѐ-ӿ]/.test(input)
}

/**
 * Codurile de functie sovietice NU sunt numere: ЛА3 inseamna "SI-NU, tipul 3",
 * nu "numarul 3". Asa ca К155ЛА3 nu se traduce aritmetic in 74xx -- e nevoie de
 * un tabel. Prima versiune genera coduri inexistente ca SN74LA3, care doar
 * poluau cautarea.
 *
 * Tabelele de mai jos contin doar corespondentele bine documentate. O intrare
 * gresita e mai daunatoare decat una lipsa: trimite cautarea pe o piesa care nu
 * are legatura, in loc sa cada elegant pe cautarea generica.
 */

/** Seriile TTL: К155/К133 = 74xx, К555 = 74LSxx, К1533 = 74ALSxx. */
const SOVIET_TTL_FUNCTIONS: Record<string, string> = {
  // porti SI-NU (NAND)
  LA1: '7420', LA2: '7430', LA3: '7400', LA4: '7410', LA6: '7440', LA8: '7401',
  // porti SAU-NU (NOR)
  LE1: '7402', LE4: '7427',
  // inversoare
  LN1: '7404', LN2: '7405',
  // SI / SAU
  LI1: '7408', LL1: '7432',
  // SAU-exclusiv
  LP5: '7486',
  // SI-SAU-NU
  LR1: '7450', LR3: '7453', LD1: '7460',
  // bistabile
  TM2: '7474', TM5: '7477', TM7: '7475', TM8: '74175', TM9: '74174',
  TV1: '7472', TV6: '7473',
  // trigger Schmitt
  TL2: '74132',
  // numaratoare
  IE2: '7490', IE4: '7492', IE5: '7493', IE6: '74192', IE7: '74193',
  // decodificatoare
  ID1: '74141', ID3: '74154', ID4: '74155', ID7: '74138',
  // registre
  IR1: '7495', IR8: '74164', IR9: '74165', IR11: '74194', IR13: '74198',
  // aritmetica si comparare
  IM3: '7483', SP1: '7485',
  // multiplexoare
  KP2: '74153', KP7: '74151', KP11: '74157',
  // monostabile
  AG3: '74123'
}

/** Seriile CMOS: К176/К561/К564/К1561 = CD4xxx. Aceleasi litere, alt inteles. */
const SOVIET_CMOS_FUNCTIONS: Record<string, string> = {
  LA7: '4011', LA8: '4012', LA9: '4023',
  LE5: '4001', LE6: '4002', LE10: '4025',
  LN1: '4009', LN2: '4049',
  LP2: '4070',
  TM2: '4013', TM3: '4042', TV1: '4027',
  IE8: '4017', IE9: '4018', IE10: '4520', IE11: '4516', IE16: '4020', IE20: '4040',
  ID1: '4028',
  IR2: '4015', IR9: '4094',
  KT3: '4066', KP1: '4052', KP2: '4051'
}

/**
 * Rezolva o piesa sovietica in echivalentul vestic.
 * Intoarce lista goala daca nu cunosc codul de functie -- caz in care cautarea
 * merge mai departe pe numele original, care uneori e indexat ca atare.
 */
function resolveSoviet(normalized: string): { parts: string[]; note?: string } {
  // K155LA3, KR1533IE7, 561LA7 -- prefixul K/KR e optional
  const m = normalized.match(/^K?R?(133|155|158|531|555|1533|176|561|564|1561)([A-Z]{2}\d{1,2})$/)
  if (!m) return { parts: [] }

  const [, series, code] = m
  const isCmos = ['176', '561', '564', '1561'].includes(series)
  const target = isCmos ? SOVIET_CMOS_FUNCTIONS[code] : SOVIET_TTL_FUNCTIONS[code]
  if (!target) return { parts: [] }

  if (isCmos) {
    return {
      parts: [`CD${target}`, `CD${target}B`, `HEF${target}B`, `MC14${target.slice(1)}`],
      note: `seria ${series} = CMOS 4000; ${code} corespunde lui CD${target}`
    }
  }

  const subFamily = series === '555' ? 'LS' : series === '1533' ? 'ALS' : ''
  const western = `74${subFamily}${target.slice(2)}`
  return {
    parts: [`SN${western}`, western, `SN${target}`, target],
    note: `seria ${series} = TTL 74${subFamily || 'xx'}; ${code} corespunde lui ${western}`
  }
}

/**
 * Reguli de familie: o piesa est-europeana se mapeaza pe echivalentul vestic
 * pastrand numarul. Se aplica in ordine, prima potrivire castiga.
 *
 * `to` primeste grupurile capturate din `from` prin $1, $2...
 */
interface FamilyRule {
  from: RegExp
  to: string[]
  note: string
}

const FAMILY_RULES: FamilyRule[] = [
  // --- Romania: Microelectronica Bucuresti / IPRS Baneasa ---
  {
    // CDB400 = 7400, CDB474 = 7474, CDB4121 = 74121: cifra 4 se inlocuieste cu 74
    from: /^CDB4(\d{2,3})[A-Z]*$/,
    to: ['SN74$1', '74$1', 'SN74LS$1'],
    note: 'CDB4xx = seria TTL 74xx fabricata de Microelectronica Bucuresti'
  },
  {
    from: /^MMC(\d{4})([A-Z]*)$/,
    to: ['CD$1', 'CD$1B', 'HEF$1B', 'MC1$1'],
    note: 'MMC = seria CMOS 4000 fabricata in Romania'
  },

  // --- Cehoslovacia: Tesla ---
  {
    from: /^MH(\d{2,4})([A-Z]*)$/,
    to: ['SN74$1', '74$1'],
    note: 'Tesla MH74xx = TTL 74xx'
  },
  {
    from: /^MHB(\d{4})([A-Z]*)$/,
    to: ['CD$1', 'CD$1B', 'SN74$1'],
    note: 'Tesla MHB = CMOS 4000 / TTL'
  },

  // --- RDG: RFT / MME ---
  {
    from: /^DL(\d{3})([A-Z]*)$/,
    to: ['SN74$1', '74$1'],
    note: 'RFT DLxxx = TTL 74xx (RDG)'
  },
  {
    from: /^V(\d{4})([A-Z]*)$/,
    to: ['CD$1', 'CD$1B'],
    note: 'RFT V4xxx = CMOS 4000 (RDG)'
  },

  // --- Polonia: CEMI ---
  {
    from: /^UCY7(\d{2,3})([A-Z]*)$/,
    to: ['SN74$1', '74$1'],
    note: 'CEMI UCY74xx = TTL 74xx'
  },
  {
    from: /^MCY7(\d{4})([A-Z]*)$/,
    to: ['CD4$1'],
    note: 'CEMI MCY = CMOS 4000'
  },

  // --- Tranzistoare japoneze: marcajul de pe capsula omite prefixul 2S ---
  {
    from: /^([ACDJK])(\d{3,4})$/,
    to: ['2S$1$2'],
    note: 'marcaj JIS pe capsula: C945 = 2SC945'
  }
]

/**
 * Echivalente punctuale, unde regula de familie nu ajuta.
 * Cheia e forma normalizata; valorile sunt cautate ca alternative.
 */
const EXPLICIT_EQUIVALENTS: Record<string, string[]> = {
  // amplificatoare operationale clasice
  MAA741: ['UA741', 'LM741', 'MC1741'],
  K140UD7: ['UA741', 'LM741'],
  K140UD8: ['LF356', 'TL081'],
  ULY7741: ['UA741', 'LM741'],
  B761: ['UA741'],
  '1458': ['LM1458', 'MC1458', 'RC4558'],

  // stabilizatoare
  K142EN5: ['LM7805', 'MC7805', 'L7805'],
  K142EN8: ['LM7812', 'L7812'],
  KREN5: ['LM7805'],

  // audio
  K174UN7: ['TBA810', 'TDA2003'],
  K174UN14: ['TDA2003', 'TDA2030'],
  K174XA2: ['TDA1220', 'TCA440'],
  MBA810: ['TBA810'],
  A210: ['TBA810'],

  // procesoare / periferice
  U880: ['Z80', 'Z8400', 'MK3880'],
  KR580VM80A: ['8080A', 'INTEL 8080'],
  KR580VV55: ['8255', 'INTEL 8255'],
  KR1810VM86: ['8086', 'INTEL 8086'],
  MHB8080: ['8080A'],

  // timere
  B555: ['NE555', 'LM555'],
  K1006VI1: ['NE555', 'LM555']
}

/**
 * Grupuri de piese complet interschimbabile de la producatori diferiti.
 * Daca nu gasesc datasheet-ul pentru una, il caut pentru celelalte:
 * pinout-ul si parametrii sunt identici.
 */
const INTERCHANGEABLE_GROUPS: string[][] = [
  ['NE555', 'LM555', 'SE555', 'MC1455', 'CA555', 'KA555', 'TLC555', 'ICM7555', 'NA555'],
  ['UA741', 'LM741', 'MC1741', 'CA741', 'RC741', 'SN72741', 'OP07'],
  ['LM358', 'MC1458', 'RC4558', 'NE532', 'TL072', 'JRC4558', 'NJM4558'],
  ['LM324', 'MC3403', 'TL074', 'RC4136', 'NJM324'],
  ['LM7805', 'MC7805', 'L7805', 'KA7805', 'UA7805', '78M05', 'LM340T5'],
  ['LM7812', 'MC7812', 'L7812', 'KA7812', 'UA7812'],
  ['LM317', 'MC1723', 'L200', 'LM350'],
  ['NE5532', 'LM4562', 'OPA2134', 'JRC5532'],
  ['LM386', 'TDA7052', 'JRC386'],
  ['TDA2030', 'TDA2030A', 'LM1875', 'TDA2050'],
  ['TDA2003', 'TDA2002', 'TDA2004'],
  ['ULN2003', 'ULN2004', 'MC1413', 'TD62003'],
  ['CD4011', 'HEF4011', 'MC14011', 'TC4011', 'HCF4011'],
  ['CD4017', 'HEF4017', 'MC14017', 'HCF4017'],
  ['SN7400', 'DM7400', 'MC7400', 'HD7400', 'CDB400'],
  ['LM339', 'MC3302', 'TL331', 'NJM339'],
  ['ATMEGA328P', 'ATMEGA328', 'ATMEGA328PB'],
  ['2N3055', 'MJ2955', 'KD502', 'BD249'],
  ['BC547', 'BC548', 'BC549', 'BC237', '2N3904'],
  ['BC557', 'BC558', 'BC559', '2N3906'],
  ['IRF540', 'IRF540N', 'IRFZ44N', 'STP55NF06'],
  ['TIP41C', 'TIP42C', 'BD139', 'BD140', 'MJE3055']
]

/** Index invers construit o singura data: piesa -> celelalte din grup. */
const GROUP_INDEX = new Map<string, string[]>()
for (const group of INTERCHANGEABLE_GROUPS) {
  for (const part of group) {
    GROUP_INDEX.set(part, group.filter((p) => p !== part))
  }
}

/**
 * Intoarce piese echivalente pentru o forma deja normalizata.
 * Rezultatul e deduplicat si nu contine piesa de intrare.
 */
export function findEquivalents(normalized: string): { parts: string[]; notes: string[] } {
  const parts = new Set<string>()
  const notes = new Set<string>()

  // codurile sovietice se rezolva prin tabel, nu prin regula de familie
  const soviet = resolveSoviet(normalized)
  for (const p of soviet.parts) parts.add(p)
  if (soviet.note) notes.add(soviet.note)

  for (const rule of FAMILY_RULES) {
    const m = normalized.match(rule.from)
    if (!m) continue
    for (const template of rule.to) {
      const expanded = template.replace(/\$(\d)/g, (_, d) => m[Number(d)] ?? '')
      if (expanded && expanded !== normalized) parts.add(expanded)
    }
    notes.add(rule.note)
    break
  }

  for (const alt of EXPLICIT_EQUIVALENTS[normalized] ?? []) parts.add(alt)
  for (const alt of GROUP_INDEX.get(normalized) ?? []) parts.add(alt)

  parts.delete(normalized)
  return { parts: [...parts], notes: [...notes] }
}
