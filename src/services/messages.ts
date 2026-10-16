import { collection, doc, limit, onSnapshot, orderBy, query, serverTimestamp, setDoc } from 'firebase/firestore';
import { firebaseAuth, requireFirestore } from '../lib/firebase';
import type { SpaceMessage } from '../types';

export const MAX_MESSAGE_LENGTH = 2000;

export function watchMessages(spaceId: string, onMessages: (messages: SpaceMessage[]) => void, onError: (cause: unknown) => void) {
  const latest = query(collection(requireFirestore(), 'circles', spaceId, 'messages'), orderBy('createdAt', 'desc'), limit(100));
  return onSnapshot(latest, { includeMetadataChanges: true }, snapshot => {
    onMessages(snapshot.docs.map(entry => {
      const data = entry.data({ serverTimestamps: 'estimate' });
      return {
        id: entry.id, senderId: data.senderId, senderName: data.senderName, text: data.text,
        createdAt: data.createdAt?.toMillis() ?? null, pending: entry.metadata.hasPendingWrites,
      };
    }).reverse());
  }, onError);
}

export async function sendMessage(spaceId: string, input: string): Promise<void> {
  const user = firebaseAuth?.currentUser;
  if (!user) throw new Error('Sign in to send a message.');
  const text = input.trim();
  if (!text || text.length > MAX_MESSAGE_LENGTH) throw new Error(`Enter a message between 1 and ${MAX_MESSAGE_LENGTH} characters.`);
  await setDoc(doc(collection(requireFirestore(), 'circles', spaceId, 'messages')), {
    senderId: user.uid, senderName: user.displayName?.trim().slice(0, 100) || 'Member',
    text, createdAt: serverTimestamp(),
  });
}
