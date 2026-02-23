/**
 * Phase 2 Testing Macro
 * @file scripts/tests/phase2-test-macro.js
 * @module cyberpunkred-messenger
 * @description Paste into Foundry console or a Script macro to test Phase 2 messaging.
 *
 * USAGE:
 *   1. Open browser console (F12)
 *   2. Paste this entire script
 *   3. Review console output
 *
 * PREREQUISITES:
 *   - At least one actor with an email address set in flags
 *   - Module loaded and initialized (game.nightcity.ready === true)
 */

(async () => {
  const ns = game.nightcity;
  const MODULE_ID = 'cyberpunkred-messenger';

  console.log('%c═══ NCM Phase 2 Test Suite ═══', 'color: #19f3f7; font-size: 14px; font-weight: bold;');

  // ─── 1. Verify namespace ───
  console.group('1. Namespace Check');
  console.log('game.nightcity.ready:', ns.ready);
  console.log('messageRepository:', ns.messageRepository ? '✅' : '❌');
  console.log('contactRepository:', ns.contactRepository ? '✅' : '❌');
  console.log('messageService:', ns.messageService ? '✅' : '❌');
  console.log('notificationService:', ns.notificationService ? '✅' : '❌');
  console.log('openInbox:', typeof ns.openInbox);
  console.log('composeMessage:', typeof ns.composeMessage);
  console.log('openContacts:', typeof ns.openContacts);
  console.groupEnd();

  // ─── 2. Find test actors ───
  console.group('2. Actor Discovery');
  const actors = game.actors.contents;
  console.log(`Total actors: ${actors.length}`);

  const actorsWithEmail = actors.filter(a => {
    const email = a.getFlag(MODULE_ID, 'email');
    return !!email;
  });
  console.log(`Actors with email: ${actorsWithEmail.length}`);
  actorsWithEmail.forEach(a => {
    console.log(`  - ${a.name}: ${a.getFlag(MODULE_ID, 'email')}`);
  });

  if (actorsWithEmail.length === 0) {
    console.warn('⚠️ No actors have email addresses set. Setting one up for testing...');

    const testActor = actors[0];
    if (testActor) {
      await testActor.setFlag(MODULE_ID, 'email', `${testActor.name.toLowerCase().replace(/\s/g, '.')}@citinet.nc`);
      console.log(`  Set email for ${testActor.name}: ${testActor.getFlag(MODULE_ID, 'email')}`);
      actorsWithEmail.push(testActor);
    } else {
      console.error('❌ No actors in world. Create at least one actor to test.');
      return;
    }
  }
  console.groupEnd();

  // ─── 3. Test MessageRepository ───
  console.group('3. MessageRepository');
  const repo = ns.messageRepository;
  const testActorId = actorsWithEmail[0].id;

  try {
    // Get or create inbox
    const inbox = await repo.getOrCreateInbox(testActorId);
    console.log('Inbox journal:', inbox?.name ?? 'FAILED');
    console.log('Inbox ID:', inbox?.id ?? 'FAILED');

    // Create a test message
    const testMsg = await repo.createMessage(testActorId, {
      messageId: foundry.utils.randomID(),
      from: 'test@citinet.nc',
      fromActorId: null,
      to: actorsWithEmail[0].getFlag(MODULE_ID, 'email'),
      toActorId: testActorId,
      subject: 'NCM Phase 2 Test Message',
      body: 'This is an automated test message from the Phase 2 verification system. If you see this, MessageRepository.createMessage() is working.',
      timestamp: new Date().toISOString(),
      network: 'CITINET',
      priority: 'normal',
      status: { read: false, saved: false, deleted: false },
      direction: 'incoming',
    });
    console.log('Created test message:', testMsg ? '✅' : '❌');

    // Retrieve messages
    const messages = await repo.getMessages(testActorId);
    console.log(`Messages in inbox: ${messages.length}`);

    // Get unread count
    const unread = await repo.getUnreadCount(testActorId);
    console.log(`Unread count: ${unread}`);

    // Mark as read
    if (testMsg) {
      const pageId = testMsg.id || testMsg._id;
      if (pageId) {
        await repo.markAsRead(testActorId, pageId);
        const newUnread = await repo.getUnreadCount(testActorId);
        console.log(`Unread after mark-read: ${newUnread}`);
      }
    }
  } catch (error) {
    console.error('MessageRepository test failed:', error);
  }
  console.groupEnd();

  // ─── 4. Test ContactRepository ───
  console.group('4. ContactRepository');
  const contactRepo = ns.contactRepository;

  try {
    const contacts = await contactRepo.getContacts(testActorId);
    console.log(`Existing contacts: ${contacts.length}`);

    // Add a test contact
    const testContact = await contactRepo.addContact(testActorId, {
      name: 'Test Fixer',
      email: 'fixer@darknet.nc',
      alias: 'The Connect',
      organization: 'Night Market',
      type: 'fixer',
      tags: ['test', 'auto-generated'],
    });
    console.log('Added test contact:', testContact ? '✅' : '❌');

    // Search contacts
    const found = await contactRepo.searchContacts(testActorId, 'fixer');
    console.log(`Search "fixer" results: ${found.length}`);

    // Global directory
    const directory = contactRepo.getGlobalActorDirectory();
    console.log(`Global actor directory: ${directory.length} entries`);
  } catch (error) {
    console.error('ContactRepository test failed:', error);
  }
  console.groupEnd();

  // ─── 5. Test UI Launches ───
  console.group('5. UI Launch Tests');
  try {
    // Test openInbox
    console.log('Opening inbox...');
    const viewer = ns.openInbox(testActorId);
    console.log('MessageViewerApp:', viewer ? '✅ opened' : '❌ failed');

    // Wait a moment then test compose
    await new Promise(r => setTimeout(r, 500));
    console.log('Opening composer...');
    const composer = ns.composeMessage({ fromActorId: testActorId });
    console.log('MessageComposerApp:', composer ? '✅ opened' : '❌ failed');

    // Test contacts
    await new Promise(r => setTimeout(r, 500));
    console.log('Opening contacts...');
    const contacts = ns.openContacts(testActorId);
    console.log('ContactManagerApp:', contacts ? '✅ opened' : '❌ failed');

  } catch (error) {
    console.error('UI launch test failed:', error);
  }
  console.groupEnd();

  // ─── 6. Test NotificationService ───
  console.group('6. NotificationService');
  try {
    const notifService = ns.notificationService;

    // Show a test toast
    notifService.showToast({
      title: 'Test Notification',
      message: 'Phase 2 notification system working!',
      type: 'info',
    });
    console.log('Toast displayed: ✅');

    // Show a message notification
    notifService.showMessageNotification({
      from: 'V',
      subject: 'Test Net-Mail',
      preview: 'This is a test notification...',
      priority: 'normal',
      actorId: testActorId,
    });
    console.log('Message notification displayed: ✅');

    // Badge refresh
    await notifService.refreshBadge();
    console.log('Badge refreshed: ✅');
  } catch (error) {
    console.error('NotificationService test failed:', error);
  }
  console.groupEnd();

  // ─── Summary ───
  console.log('%c═══ Phase 2 Manual Tests Complete ═══', 'color: #F65261; font-size: 14px; font-weight: bold;');
  console.log('Check the UI windows that opened and verify:');
  console.log('  • Inbox shows the test message');
  console.log('  • Composer opens with FROM dropdown');
  console.log('  • Contact manager shows the test contact');
  console.log('  • Toast notification appeared top-right');
  console.log('');
  console.log('Run game.nightcity.verifyPhase2() for automated checks.');
})();
