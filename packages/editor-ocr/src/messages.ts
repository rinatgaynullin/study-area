import type { Messages } from '@rich-editor/core';

/** Подписи возможности по языкам. Редактор берёт их сам через `EditorFeature.messages`. */
export const OCR_MESSAGES: Record<string, Messages> = {
  ru: {
    ocr_recognize: 'Распознать фото',
    ocr_recognizing: 'Распознаём фото…',
    error_recognize_failed: 'Не удалось распознать фото.',
    error_recognize_empty: 'Распознавание не вернуло текст.',
    error_recognize_too_many: 'Не больше {max} фото за раз.',
  },
  en: {
    ocr_recognize: 'Recognize photo',
    ocr_recognizing: 'Recognizing photo…',
    error_recognize_failed: 'Failed to recognize the photo.',
    error_recognize_empty: 'Recognition returned no text.',
    error_recognize_too_many: 'At most {max} photos at a time.',
  },
};
