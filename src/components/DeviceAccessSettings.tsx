import { useEffect, useRef, useState } from 'react';
import { Switch, Text, View } from 'react-native';
import { backendError } from '../lib/firebase';
import type { DeviceAccess } from '../lib/calls';
import { setMediaRequester } from '../services/circles';
import type { SpaceMember } from '../types';
import { Avatar, Button, ui } from './Ui';
import { colors } from '../theme';

export function DeviceAccessSettings({ spaceId, ownerId, uid, members, disabled, onRequest }: {
  spaceId: string; ownerId: string; uid: string; members: SpaceMember[]; disabled: boolean;
  onRequest: (member: SpaceMember, access: DeviceAccess) => void;
}) {
  const [saving, setSaving] = useState<string | null>(null), [error, setError] = useState<string | null>(null);
  const live = useRef(true), lock = useRef(false);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const isOwner = uid === ownerId, canRequest = isOwner || members.some(member => member.uid === uid && member.canRequestMedia);
  async function authorize(memberId: string, value: boolean) {
    if (lock.current) return;
    lock.current = true; setSaving(memberId); setError(null);
    try { await setMediaRequester(spaceId, memberId, value); }
    catch (cause) { if (live.current) setError(backendError(cause)); }
    finally { lock.current = false; if (live.current) setSaving(null); }
  }
  return <>
    <Text style={ui.body}>Request a live microphone, front camera or rear camera session. Camera requests include audio. The person must approve each request on their phone before anything starts.</Text>
    <Text style={ui.caption}>Sharing has a visible indicator and Stop sharing button. On Android, the person can also approve background sharing for that session, with a visible notification. The requester keeps Closeby open. Changing cameras needs a new approval.</Text>
    {isOwner ? <Text style={ui.body}>You can send requests as space owner. Invite a person to your space, then authorize them below to send requests too.</Text>
      : <Text style={ui.body}>{canRequest ? 'The space owner has authorized you to send requests.' : 'Only the space owner and members they authorize can send requests.'}</Text>}
    {error && <View style={ui.error}><Text accessibilityRole="alert" style={ui.errorText}>{error}</Text></View>}
    {members.map(member => <View key={member.uid} style={[ui.card, { padding: 15, gap: 12 }]}>
      <View style={ui.row}><Avatar device={member} size={42} /><View style={{ flex: 1 }}><Text style={ui.rowTitle}>{member.name}{member.uid === uid ? ' (you)' : ''}</Text>
        <Text style={ui.caption}>{member.uid === ownerId ? 'Space owner' : member.canRequestMedia ? 'Authorized requester' : 'Member'}</Text></View>
        {isOwner && member.uid !== ownerId && <Switch accessibilityLabel={`Allow ${member.name} to request camera or microphone access`} value={member.canRequestMedia === true} disabled={saving !== null}
          onValueChange={value => void authorize(member.uid, value)} trackColor={{ false: '#314259', true: colors.blue }} thumbColor="#FFFFFF" />}
      </View>
      {saving === member.uid && <Text style={ui.caption}>Saving request permission...</Text>}
      {canRequest && member.uid !== uid && <>
        <Button secondary title="Request microphone" disabled={disabled || saving !== null} onPress={() => onRequest(member, 'microphone')} />
        <Button secondary title="Request front camera + mic" disabled={disabled || saving !== null} onPress={() => onRequest(member, 'front')} />
        <Button secondary title="Request rear camera + mic" disabled={disabled || saving !== null} onPress={() => onRequest(member, 'back')} />
      </>}
    </View>)}
    {members.length < 2 && <Text style={ui.body}>Invite another person to your space to send a request.</Text>}
  </>;
}
