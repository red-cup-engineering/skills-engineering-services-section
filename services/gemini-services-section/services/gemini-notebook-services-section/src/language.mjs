// Translate standard language tags at the provider boundary.
export const notebookLanguage=language=>({'zh-CN':'zh_Hans','zh-SG':'zh_Hans','zh-Hans':'zh_Hans','zh-TW':'zh_Hant','zh-HK':'zh_Hant','zh-Hant':'zh_Hant'}[language]??language);
