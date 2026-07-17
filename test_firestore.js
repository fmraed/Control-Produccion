import { readFileSync } from 'fs';
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';

const fbConfig = JSON.parse(readFileSync('firebase-applet-config.json', 'utf8'));
const app = initializeApp(fbConfig);
const db = getFirestore(app);

async function run() {
  const qs = await getDocs(collection(db, "insumos_transits"));
  console.log("Transits in DB:");
  qs.docs.forEach(d => console.log(d.data()));
  process.exit(0);
}
run();
