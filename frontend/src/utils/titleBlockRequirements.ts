import type { SubmissionType, TitleBlockData } from '../types';

/** Title block fields whose mandatory status depends on the submission type. */
export type RequirableField =
  | 'professionalEngineer'
  | 'peStamp'
  | 'projectName'
  | 'mainContractor'
  | 'licensedPlumber'
  | 'lpStamp';

const COMMON_REQUIRED: readonly RequirableField[] = ['projectName', 'mainContractor'];

const REQUIRED_FIELDS: Record<SubmissionType, readonly RequirableField[]> = {
  PE: ['professionalEngineer', 'peStamp', ...COMMON_REQUIRED],
  LP: [...COMMON_REQUIRED, 'licensedPlumber', 'lpStamp'],
};

/** Until a submission type is chosen, only the fields both types need are flagged. */
function requiredFor(titleBlock: TitleBlockData): readonly RequirableField[] {
  return titleBlock.submissionType ? REQUIRED_FIELDS[titleBlock.submissionType] : COMMON_REQUIRED;
}

export const REQUIRABLE_FIELD_LABELS: Record<RequirableField, string> = {
  professionalEngineer: 'Professional Engineer',
  peStamp:              'PE Stamp & Signature',
  projectName:          'Project Title',
  mainContractor:       'Main Contractor',
  licensedPlumber:      'Licensed Plumber',
  lpStamp:              'LP Stamp & Signature',
};

export function isFieldRequired(titleBlock: TitleBlockData, field: RequirableField): boolean {
  return requiredFor(titleBlock).includes(field);
}

/** Labels of mandatory fields that are still blank, in form order. Empty = ready to export. */
export function getMissingTitleBlockFields(titleBlock: TitleBlockData): string[] {
  const missing = requiredFor(titleBlock)
    .filter((f) => !(titleBlock[f] ?? '').trim())
    .map((f) => REQUIRABLE_FIELD_LABELS[f]);
  return titleBlock.submissionType ? missing : ['Submission Type (PE / LP)', ...missing];
}
