/**
 * Organization access requests the daily check couldn't confirm.
 *
 *   npm run review-claims                    list held (and pending) requests
 *   npm run review-claims -- check <id>      run the website check again now
 *   npm run review-claims -- approve <id>    approve by hand (you checked it yourself)
 *   npm run review-claims -- deny <id> "why" deny, with a reason the person sees
 *
 * Runs against production with your gcloud credentials
 * (`gcloud auth application-default login`), or against the emulator when
 * FIRESTORE_EMULATOR_HOST is set.
 */
process.env.GCLOUD_PROJECT ??= 'universal-complaint-system';

async function main() {
  const { approveClaim, checkClaim } = await import('../functions/src/company');
  const { db, FieldValue, notify } = await import('../functions/src/common');
  const [cmd, id, ...rest] = process.argv.slice(2);

  if (!cmd) {
    const snap = await db.collection('claims').where('status', 'in', ['held', 'pending']).get();
    if (snap.empty) return console.log('Nothing waiting.');
    for (const d of snap.docs) {
      const c = d.data();
      console.log(`${d.id}  [${c.status}]  ${c.email} -> ${c.subjectName}  site: ${c.website ?? '-'}`);
      if (c.note) console.log(`    ${c.note}`);
    }
    return;
  }
  if (!id) throw new Error('Which claim id?');
  if (cmd === 'check') console.log(await checkClaim(id));
  else if (cmd === 'approve') await approveClaim(id, 'Approved by the operator.');
  else if (cmd === 'deny') {
    const reason = rest.join(' ') || 'We could not confirm this email belongs to the organization.';
    const ref = db.doc(`claims/${id}`);
    const claim = await ref.get();
    await ref.update({ status: 'denied', note: reason, decidedAt: FieldValue.serverTimestamp() });
    await notify([claim.get('uid')], {
      type: 'access',
      subjectId: claim.get('subjectId'),
      text: `Your request to respond for ${claim.get('subjectName')} was not approved: ${reason}`,
    });
  } else throw new Error(`Unknown command ${cmd}`);
  console.log('Done.');
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
