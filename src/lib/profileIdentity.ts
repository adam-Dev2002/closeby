type ProfileIdentitySource = {
  displayName?: string | null;
  photoURL?: string | null;
  providerData?: readonly {
    providerId: string;
    displayName?: string | null;
    photoURL?: string | null;
  }[];
};

// Linked Google accounts can have a provider photo without a main account photo.
// Use the same identity for our own pin and the profile shared with the space.
export function profileIdentity(user: ProfileIdentitySource | null | undefined) {
  const google = user?.providerData?.find(provider => provider.providerId === 'google.com');
  return {
    displayName: user?.displayName?.trim() || google?.displayName?.trim() || null,
    photoURL: user?.photoURL?.trim() || google?.photoURL?.trim() || null,
  };
}
