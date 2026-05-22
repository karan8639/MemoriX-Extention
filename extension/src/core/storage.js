export const storage = {
  get: (key) => chrome.storage.local.get(key),
  set: (data) => chrome.storage.local.set(data),
};
