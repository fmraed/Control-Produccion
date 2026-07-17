const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs } = require('firebase/firestore');

const firebaseConfig = {
  projectId: "ai-studio-b7cabb18-1098-43f9-ba8a-659a08ce70b8"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function run() {
  const querySnapshot = await getDocs(collection(db, 'monthly_snapshots'));
  querySnapshot.forEach((doc) => {
    console.log(doc.id, " => ", doc.data().year, doc.data().month);
  });
}
run();
