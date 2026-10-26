import dotenv from 'dotenv';
dotenv.config();
import { initializeApp, getApps } from 'firebase/app';
import { getFirestore, collection, getDocs, getCountFromServer } from 'firebase/firestore';

async function checkFirestore() {
  const firebaseConfig = {
    projectId: process.env.FIREBASE_PROJECT_ID,
    apiKey: process.env.FIREBASE_API_KEY,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.FIREBASE_APP_ID,
  };

  const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
  const db = getFirestore(app);

  console.log(`Checking Firestore for project: ${process.env.FIREBASE_PROJECT_ID}...`);

  for (const colName of ['clone_users', 'users', 'clone_withdrawals', 'withdrawals', 'clone_transactions', 'transactions']) {
    try {
      const colRef = collection(db, colName);
      const countSnap = await getCountFromServer(colRef);
      console.log(`[Firestore Count] ${colName}: ${countSnap.data().count} documents`);
    } catch (err: any) {
      console.warn(`[Firestore Count Failed] ${colName}: ${err.message}`);
    }
  }
}

checkFirestore().catch(console.error);
