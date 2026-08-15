import { probeUrl } from '../../http'
import type { RawHit, Source, SourceContext } from '../types'

/**
 * Incearca direct URL-uri deterministe de la producatori.
 *
 * Cand merge, e cea mai buna cale posibila: un singur request, PDF oficial,
 * fara intermediari. Tiparele de mai jos au fost verificate live -- cele care
 * s-au dovedit nesigure (NXP, Vishay, Renesas) sunt lasate deliberat pe seama
 * cautarii web, ca sa nu pierdem timp pe 404-uri.
 */

interface UrlPattern {
  manufacturer: string
  /** Prefixe de part number pentru care are rost sa incerc acest tipar. */
  applies: RegExp
  build: (part: string) => string[]
}

const PATTERNS: UrlPattern[] = [
  {
    // `lit/gpn` accepta orice part number TI si redirectioneaza catre PDF-ul corect
    manufacturer: 'Texas Instruments',
    applies: /^(SN|CD|TL|LM|LP|TPS|TLV|TLC|THS|UA|UC|INA|OPA|ADS|DAC|REF|TPA|TPD|TCA|TXB|UCC|DRV|BQ|MSP|ISO|PCM|NE5|SE5)/,
    build: (p) => [
      `https://www.ti.com/lit/gpn/${p.toLowerCase()}`,
      `https://www.ti.com/lit/ds/symlink/${p.toLowerCase()}.pdf`
    ]
  },
  {
    manufacturer: 'STMicroelectronics',
    applies: /^(STM32|STM8|L78|L79|TDA|VIPER|VNH|LIS|LSM|ST7|L6|L29|TS)/,
    build: (p) => {
      const urls = [`https://www.st.com/resource/en/datasheet/${p.toLowerCase()}.pdf`]
      // ST documenteaza stabilizatoarele pe familie, nu pe tensiune: L7805 e in "l78"
      const family = p.match(/^(L7[89])\d{2}/)
      if (family) urls.push(`https://www.st.com/resource/en/datasheet/${family[1].toLowerCase()}.pdf`)
      return urls
    }
  },
  {
    manufacturer: 'onsemi',
    applies: /^(MC|NCP|NCV|LM|MBR|MUR|FAN|KA|2N|BC|TIP|MJE|BD)/,
    build: (p) => [`https://www.onsemi.com/pdf/datasheet/${p.toLowerCase()}-d.pdf`]
  },
  {
    manufacturer: 'Analog Devices',
    applies: /^(AD|OP|ADG|ADM|ADP|ADUM|ADXL|MAX)/,
    build: (p) => [
      `https://www.analog.com/media/en/technical-documentation/data-sheets/${p.toUpperCase()}.pdf`
    ]
  },
  {
    manufacturer: 'Nexperia',
    applies: /^74(HC|HCT|LVC|AHC|AUP)/,
    build: (p) => {
      const urls = [`https://assets.nexperia.com/documents/data-sheet/${p.toUpperCase()}.pdf`]
      // Nexperia publica HC si HCT in acelasi document: 74HC00 -> 74HC_HCT00.pdf
      const hc = p.match(/^74HCT?(\d{2,4})$/i)
      if (hc) urls.push(`https://assets.nexperia.com/documents/data-sheet/74HC_HCT${hc[1]}.pdf`)
      return urls
    }
  },
  {
    manufacturer: 'Diodes Inc.',
    applies: /^(AP|AZ|ZX|DMN|DMP|BAT|BAV)/,
    build: (p) => [`https://www.diodes.com/assets/Datasheets/${p.toUpperCase()}.pdf`]
  },
  {
    manufacturer: 'Espressif',
    applies: /^ESP/,
    build: (p) => [
      `https://www.espressif.com/sites/default/files/documentation/${p.toLowerCase()}_datasheet_en.pdf`
    ]
  }
]

export const directUrlSource: Source = {
  id: 'direct',
  label: 'Site-uri producatori (link direct)',
  tier: 'manufacturer',
  note: 'Incearca tiparele de URL cunoscute ale producatorilor. Rapid si oficial cand piesa e recunoscuta.',

  async search(ctx: SourceContext): Promise<RawHit[]> {
    const { analysis, signal } = ctx
    // tiparele sunt construite pe coduri de piese; un nume de aparat nu se potriveste
    if (analysis.queryType === 'device') return []
    const candidates: Array<{ url: string; manufacturer: string; query: string }> = []

    // primele doua variante sunt suficiente: tiparele functioneaza pe radacina piesei
    for (const variant of analysis.variants.slice(0, 2)) {
      for (const pattern of PATTERNS) {
        if (!pattern.applies.test(variant)) continue
        for (const url of pattern.build(variant)) {
          candidates.push({ url, manufacturer: pattern.manufacturer, query: variant })
        }
      }
    }

    if (!candidates.length) return []

    // verific in paralel: sunt hosturi diferite, iar throttle-ul e per host
    const checked = await Promise.all(
      candidates.slice(0, 12).map(async (c) => {
        if (signal.aborted) return null
        const probe = await probeUrl(c.url, { signal, referer: 'https://www.google.com/' })
        if (!probe.ok || !probe.contentType.includes('pdf')) return null
        return {
          title: `${c.query} - datasheet ${c.manufacturer}`,
          url: probe.finalUrl,
          query: c.query,
          kind: 'datasheet' as const,
          manufacturer: c.manufacturer,
          sizeBytes: probe.sizeBytes,
          // sursa oficiala: cel mai mare bonus din sistem
          confidenceBoost: 0.35
        }
      })
    )

    return checked.filter((h): h is NonNullable<typeof h> => h !== null)
  }
}
