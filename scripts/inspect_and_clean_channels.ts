import { db, getColName, getForceJoinChannels, getAppSettings, updateAppSettings, deleteForceJoinChannel } from '../server/db.ts';
import { collection, getDocs, deleteDoc, doc } from 'firebase/firestore';

async function main() {
  const colName = getColName('force_join_channels');
  console.log('==================================================');
  console.log('🔍 INSPECTING & PURGING STALE FORCE JOIN CHANNELS');
  console.log(`📁 Firestore collection: ${colName}`);
  console.log('==================================================\n');

  // 1. Check existing documents in Firestore
  let snap = await getDocs(collection(db, colName));
  console.log(`Initial Firestore document count in ${colName}: ${snap.size}`);

  let deletedCount = 0;
  for (const d of snap.docs) {
    const data = d.data();
    const id = (d.id || '').toLowerCase();
    const channelId = (data.channelId || '').toLowerCase();
    const username = (data.username || '').toLowerCase();

    console.log(`  Found doc: ID=${d.id}, channelId=${data.channelId}, username=${data.username}, title="${data.title}"`);

    const isLegacy =
      id === 'chan_main_updates' ||
      id === 'chan_payment_proofs' ||
      channelId.includes('teleearn') ||
      username.includes('teleearn');

    if (isLegacy) {
      console.log(`  ❌ Deleting legacy channel doc: ${d.id}`);
      await deleteDoc(doc(db, colName, d.id));
      await deleteForceJoinChannel(d.id);
      deletedCount++;
    }
  }

  console.log(`\nDeleted ${deletedCount} stale legacy channel document(s).`);

  // 2. Check and clean AppSettings payoutChannelId
  const settings = await getAppSettings();
  if (settings.payoutChannelId && settings.payoutChannelId.toLowerCase().includes('teleearn')) {
    console.log(`Cleaning stale settings payoutChannelId: "${settings.payoutChannelId}" -> ""`);
    await updateAppSettings({ payoutChannelId: '' });
  }

  // 3. Re-verify active force-join channels via repository
  const remainingChannels = await getForceJoinChannels(false);
  console.log(`\nRemaining channels in repository (${remainingChannels.length}):`);
  remainingChannels.forEach((ch) => {
    console.log(`  - [${ch.id}] "${ch.title}" (${ch.channelId}) enabled=${ch.isEnabled}`);
  });

  const activeEnabled = await getForceJoinChannels(true);
  console.log(`Active enabled channels for users: ${activeEnabled.length}`);

  console.log('\n==================================================');
  console.log('✅ FORCE JOIN CHANNEL INSPECTION & CLEANUP COMPLETE');
  console.log('==================================================');

  process.exit(0);
}

main().catch((err) => {
  console.error('Cleanup script error:', err);
  process.exit(1);
});
