window.OneSignalDeferred = window.OneSignalDeferred || [];

OneSignalDeferred.push(async function(OneSignal) {
  await OneSignal.init({
    appId: "YOUR_ONESIGNAL_APP_ID",
    notifyButton: {
      enable: true
    }
  });
});