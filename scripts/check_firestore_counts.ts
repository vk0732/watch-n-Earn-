import dotenv from 'dotenv';
dotenv.config();
import { db, getColName } from '../server/db.ts';
import { collection, getCountFromServer, getDocs, limit, query } from 'firebase/firestore';

async function checkFirestore() {
  console.log('Checking Firestore using server/db instance...');

  const colNames = [
    getColName('users'),
    'users',
    'clone_users',
    getColName('withdrawals'),
    'withdrawals',
    'clone_withdrawals',
    getColName('transactions'),
    'transactions',
    'clone_transactions',
  ];

  const uniqueCols = Array.from(new Set(colNames));

  for (const colName of uniqueCols) {
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
