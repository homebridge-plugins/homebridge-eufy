/**
 * Fails the specification that produced an unhandled rejection, rather than letting the gate report and pass it.
 *
 * A promise nothing observes can carry a fault out of the code under test and into no assertion at all, so a
 * specification can pass while the behaviour it names is broken. Rethrowing makes the rejection an uncaught
 * exception, which the runner attributes to the file it escaped from.
 */
process.on('unhandledRejection', (reason) => {
  throw reason;
});
