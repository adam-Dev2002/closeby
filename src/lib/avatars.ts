export const avatarFaces = [
  { id: 1, label: 'Short hair' },
  { id: 2, label: 'Bob haircut' },
  { id: 3, label: 'Curly hair' },
  { id: 4, label: 'Ponytail' },
  { id: 5, label: 'Glasses' },
  { id: 6, label: 'Hair bun' },
  { id: 7, label: 'Beard' },
  { id: 8, label: 'Headscarf' },
] as const;

export const avatarBackgrounds = [
  { id: 'blue', label: 'Blue', color: '#A9D6FF' },
  { id: 'purple', label: 'Purple', color: '#CFC0FF' },
  { id: 'coral', label: 'Coral', color: '#FFC0B4' },
  { id: 'mint', label: 'Mint', color: '#A8E8CD' },
  { id: 'gold', label: 'Gold', color: '#FFE09C' },
  { id: 'slate', label: 'Slate', color: '#C0D0DF' },
] as const;

type FaceId = typeof avatarFaces[number]['id'];
type BackgroundId = typeof avatarBackgrounds[number]['id'];
export type AvatarId = `face-${FaceId}-${BackgroundId}`;

export const avatarPlaceholderSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="50" fill="#25394F"/><g transform="translate(26 26) scale(2)" fill="none" stroke="#BCD0E8" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="7" r="4"/><path d="M4 22v-2a8 8 0 0 1 16 0v2H4Z"/></g></svg>';

export function avatarImageSource(profile: { avatarId?: string | null; photoURL?: string | null }): string | null {
  if (isAvatarId(profile.avatarId)) return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(avatarSvg(profile.avatarId));
  try {
    const url = new URL(profile.photoURL ?? '');
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch { return null; }
}

export function isAvatarId(value: unknown): value is AvatarId {
  return typeof value === 'string' && /^face-[1-8]-(blue|purple|coral|mint|gold|slate)$/.test(value);
}

// All portrait paths and colors are curated here. Saved IDs never supply XML.
const portraits = [
  { skin: '#DCA074', shade: '#C47F55', shirt: '#356C9E', hair: '#26313C',
    back: '<path d="M28 49V34c0-17 11-24 24-24 17 0 23 13 23 27v12Z"/>',
    front: '<path d="M29 37c-4-12 5-24 18-25 12-7 28 3 29 15-8 4-13-2-15-7-6 10-18 13-32 17Z"/>' },
  { skin: '#F2C2A0', shade: '#D99E7E', shirt: '#9976B9', hair: '#35273A',
    back: '<path d="M23 74V36c0-18 11-26 27-26s27 10 27 28v36c-8 5-15 5-20 0H42c-5 4-12 4-19 0Z"/>',
    front: '<path d="M26 39c1-19 13-25 25-25 13 0 24 9 23 25-10-1-16-7-20-15-6 10-17 15-28 15Z"/>' },
  { skin: '#855638', shade: '#684027', shirt: '#47918B', hair: '#24242D',
    back: '<path d="M23 48c-7-7-4-16 3-19-1-11 7-17 15-15 7-9 19-7 23-1 11-1 18 7 15 16 8 6 7 17-2 22H23Z"/>',
    front: '<path d="M28 35c-7-2-7-10 0-13 4-10 14-12 21-5 5-10 18-9 22-1 9 0 11 12 4 16-7 5-13-1-16-6-8 9-19 12-31 9Z"/>' },
  { skin: '#F7CFB4', shade: '#DFAE8C', shirt: '#BC686C', hair: '#A95035',
    back: '<path d="M26 46V34c0-17 10-23 24-23 13 0 23 10 25 23 16-3 22 10 17 23-4 12-15 18-24 26l-2-42Z"/>',
    front: '<path d="M28 36c0-15 11-24 24-23 14 0 24 10 22 26-11 0-18-6-25-17-3 8-11 13-21 14Z"/>' },
  { skin: '#B87951', shade: '#935A3D', shirt: '#506FA9', hair: '#30261E',
    back: '<path d="M26 48V34c0-16 12-23 26-23 15 0 23 10 23 24v15Z"/>',
    front: '<path d="M27 36c0-18 18-30 34-23 13 3 18 11 15 24l-7-4-3-12c-9 10-24 14-39 15Z"/>',
    detail: '<g fill="none" stroke="#2F4054" stroke-width="2.8"><rect x="31" y="42" width="16" height="12" rx="5"/><rect x="53" y="42" width="16" height="12" rx="5"/><path d="M47 46h6M27 44l4 2M69 46l4-2"/></g>' },
  { skin: '#6E4936', shade: '#573623', shirt: '#BF934A', hair: '#27232A',
    back: '<circle cx="51" cy="13" r="12"/><path d="M26 49V34c0-17 12-24 25-24 16 0 25 11 25 26v15Z"/>',
    front: '<path d="M28 37c1-18 11-25 24-25 16 0 26 11 23 25-8-1-15-6-24-17-5 9-12 15-23 17Z"/>',
    detail: '<g fill="#F5CE6C"><circle cx="29" cy="54" r="3"/><circle cx="72" cy="54" r="3"/></g>' },
  { skin: '#D9A784', shade: '#BF8764', shirt: '#52647D', hair: '#49352A',
    back: '<path d="M28 45V32c0-14 12-22 24-22 13 0 22 8 22 24v12Z"/>',
    front: '<path d="M29 31c2-12 12-19 24-19 13 0 20 9 21 21-10-5-31-7-45-2Z"/>',
    detail: '<path d="M33 54c5 9 11 7 17 7s13 2 18-7c0 13-7 20-18 20S33 67 33 54Z" fill="#49352A"/><path d="M45 63q5 3 10 0" fill="none" stroke="#F5D4B7" stroke-width="2.2" stroke-linecap="round"/>' },
  { skin: '#C58B66', shade: '#AA6C49', shirt: '#64769D', hair: '#687DA8',
    back: '<path d="M19 83c5-15 6-24 6-40 0-20 10-33 26-33s27 13 27 33c0 16 1 25 5 40-18 13-47 13-64 0Z"/>',
    front: '<path d="M27 43c0-20 11-30 24-30 14 0 25 12 24 33-7-8-14-17-20-24-5 8-15 15-28 21Z"/><path d="M27 54c7 19 24 27 50 28l-6 11c-27-4-41-13-47-29Z"/>' },
] as const;

export function avatarSvg(id: string): string {
  const validId = isAvatarId(id) ? id : 'face-1-blue';
  const [, faceNumber, backgroundId] = validId.split('-');
  const face = portraits[Number(faceNumber) - 1]!;
  const background = avatarBackgrounds.find(item => item.id === backgroundId)!;
  const detail = 'detail' in face ? face.detail : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"><defs><clipPath id="portrait"><circle cx="50" cy="50" r="50"/></clipPath></defs><g clip-path="url(#portrait)"><rect width="100" height="100" fill="${background.color}"/><circle cx="81" cy="16" r="30" fill="#FFFFFF" opacity=".14"/><g fill="${face.hair}">${face.back}</g><path d="M14 102c2-21 14-28 36-28s34 7 36 28Z" fill="${face.shirt}"/><path d="M41 67h18v15c-5 7-13 7-18 0Z" fill="${face.skin}"/><path d="M41 68h18v7c-6 4-12 4-18 0Z" fill="${face.shade}"/><ellipse cx="29" cy="48" rx="5" ry="8" fill="${face.skin}"/><ellipse cx="71" cy="48" rx="5" ry="8" fill="${face.skin}"/><path d="M30 35c0-14 9-20 20-20s20 6 20 20v17c0 14-9 23-20 23s-20-9-20-23Z" fill="${face.skin}"/><g fill="${face.hair}">${face.front}</g><g fill="none" stroke="#40312D" stroke-width="2" stroke-linecap="round"><path d="M36 41h7M57 41h7" opacity=".55"/><path d="M38 47v2M61 47v2"/><path d="M49 48l-2 9h4" stroke="${face.shade}"/><path d="M43 63q7 5 14 0"/></g><ellipse cx="36" cy="56" rx="4" ry="2" fill="#EC8C86" opacity=".28"/><ellipse cx="64" cy="56" rx="4" ry="2" fill="#EC8C86" opacity=".28"/>${detail}<path d="M28 89v13M72 89v13" stroke="#FFFFFF" stroke-width="2" opacity=".15"/></g></svg>`;
}
