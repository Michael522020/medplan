import { s } from '../../common/validation/schema.js';

/**
 * WADO-RS 取图请求校验。
 */

/** 契约 WadoRetrieveRequest */
export const wadoRetrieveSchema = s.object({
  studyUid: s.string({
    pattern: /^[0-9]+(\.[0-9]+)+$/,
    patternHint: '不是合法的 DICOM UID',
    max: 64,
  }),
  seriesUid: s.string({
    pattern: /^[0-9]+(\.[0-9]+)+$/,
    patternHint: '不是合法的 DICOM UID',
    max: 64,
  }),
  instanceNumbers: s.optional(
    s.array(s.number({ integer: true, min: 1 }), { maxItems: 200 })
  ),
  sopInstanceUids: s.optional(s.array(s.string({ max: 128 }), { maxItems: 200 })),
  transferSyntaxUid: s.string({ min: 1, max: 64 }),
  maxInstances: s.optional(s.number({ integer: true, min: 1, max: 200 })),
  metadataOnly: s.optional(s.boolean()),
});

export type WadoRetrieveInput = {
  studyUid: string;
  seriesUid: string;
  instanceNumbers?: number[];
  sopInstanceUids?: string[];
  transferSyntaxUid: string;
  maxInstances?: number;
  metadataOnly?: boolean;
};
