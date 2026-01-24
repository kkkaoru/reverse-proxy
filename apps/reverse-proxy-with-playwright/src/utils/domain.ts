// Domain extraction utility
// Execute with bun: wrangler dev

export const extractDomain = (url: string): string => {
  try {
    const parsedUrl: URL = new URL(url);
    return parsedUrl.hostname;
  } catch {
    return '';
  }
};

export const isValidUrl = (url: string): boolean => {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
};
