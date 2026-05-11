const functions = require("firebase-functions/v2/https");
const admin     = require("firebase-admin");

admin.initializeApp();

/**
 * Сменя паролата на управителски акаунт.
 * Само Owner (role==="owner") може да я извика.
 * data: { uid: string, newPassword: string }
 */
exports.resetUserPassword = functions.onCall(
  { region: "us-central1" },
  async (request) => {
    if (!request.auth) {
      throw new functions.HttpsError(
        "unauthenticated",
        "Трябва да сте влезли в системата."
      );
    }

    const callerDoc = await admin.firestore()
      .collection("users").doc(request.auth.uid).get();
    if (!callerDoc.exists || callerDoc.data().role !== "owner") {
      throw new functions.HttpsError(
        "permission-denied",
        "Само Owner може да сменя пароли на управители."
      );
    }

    const { uid, newPassword } = request.data;
    if (!uid || typeof uid !== "string") {
      throw new functions.HttpsError("invalid-argument", "Липсва uid.");
    }
    if (!newPassword || newPassword.length < 6) {
      throw new functions.HttpsError(
        "invalid-argument",
        "Паролата трябва да е поне 6 символа."
      );
    }

    const targetDoc = await admin.firestore()
      .collection("users").doc(uid).get();
    if (targetDoc.exists && targetDoc.data().role === "owner") {
      throw new functions.HttpsError(
        "permission-denied",
        "Не може да се сменя паролата на Owner акаунт."
      );
    }

    await admin.auth().updateUser(uid, { password: newPassword });
    return { success: true };
  }
);
