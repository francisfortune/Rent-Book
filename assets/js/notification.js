// import { getMessaging,getToken,onMessage }

// from "https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js";

// import { app } from "./firebase.js";

// const messaging=getMessaging(app);

// export async function initNotifications(){

// const permission=await Notification.requestPermission();

// if(permission!=="granted") return;

// const token=await getToken(messaging,{
// vapidKey:"YOUR_KEY"
// });

// console.log("FCM Token:",token);

// }

// onMessage(messaging,(payload)=>{

// alert(payload.notification.title);

// });