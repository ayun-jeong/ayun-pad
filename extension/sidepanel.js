const DEFAULT_URL = 'https://ayun-jeong.github.io/ayun-pad/';
const frame = document.querySelector('#pad');
const status = document.querySelector('#status');
const address = document.querySelector('#address');
let padOrigin;
function connect(value) {
  const url = new URL(value);
  const allowed = url.origin === 'https://ayun-jeong.github.io' ||
    (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname));
  if (!allowed || url.username || url.password) throw new Error('배포된 ayun pad 또는 로컬 개발 서버 주소를 입력해 주세요.');
  url.searchParams.set('panel', '1');
  padOrigin = url.origin;
  frame.src = url.href;
  address.value = value;
}
chrome.storage.local.get({ padURL: DEFAULT_URL }).then(({ padURL }) => connect(padURL)).catch((e) => { status.textContent = e.message; });
document.querySelector('#settings').addEventListener('click', () => {
  const config = document.querySelector('#config');
  config.hidden = !config.hidden;
  if (!config.hidden) address.focus();
});
document.querySelector('#config').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    connect(address.value);
    await chrome.storage.local.set({ padURL: address.value });
    document.querySelector('#config').hidden = true;
    status.textContent = 'pad를 연결했어요.';
  } catch (error) { status.textContent = error.message; }
});
document.querySelector('#capture').addEventListener('click', async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('자료 웹사이트를 먼저 열어 주세요.');
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => ({ title: document.title, url: location.href, text: getSelection()?.toString() ?? '' }),
    });
    if (!result?.result || !/^https?:\/\//.test(result.result.url)) throw new Error('일반 웹사이트에서 이용해 주세요.');
    frame.contentWindow.postMessage({ type: 'ayunpad:capture', ...result.result }, padOrigin);
    status.textContent = 'pad의 참고 자료에서 가져온 글과 출처를 확인하세요.';
  } catch {
    status.textContent = '웹사이트에서 pad 확장 아이콘을 한 번 누른 뒤 다시 시도해 주세요. 브라우저 설정·스토어 페이지는 가져올 수 없어요.';
  }
});
