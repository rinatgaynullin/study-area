export interface ChemistryTemplate {
  id: string;
  /** Ключ перевода названия. */
  labelKey: string;
  code: string;
}

/** Готовые структуры для диалога: по одной на каждую поддерживаемую конструкцию языка. */
export const CHEMISTRY_TEMPLATES: ChemistryTemplate[] = [
  { id: 'benzene', labelKey: 'chemistry_template_benzene', code: '**6(------)' },
  { id: 'cyclohexane', labelKey: 'chemistry_template_cyclohexane', code: '*6(------)' },
  { id: 'cyclopentane', labelKey: 'chemistry_template_cyclopentane', code: '*5(-----)' },
  { id: 'phenol', labelKey: 'chemistry_template_phenol', code: '**6(---(-OH)---)' },
  { id: 'ethanol', labelKey: 'chemistry_template_ethanol', code: 'CH_3-CH_2-OH' },
  { id: 'acetic-acid', labelKey: 'chemistry_template_acetic_acid', code: 'CH_3-C(=[1]O)-[7]OH' },
  { id: 'propene', labelKey: 'chemistry_template_propene', code: 'CH_3-CH=CH_2' },
  { id: 'methane', labelKey: 'chemistry_template_methane', code: 'H-C(-[2]H)(-[6]H)-H' },
];
