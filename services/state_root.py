"""Where SuperPinkie keeps its state, on the platform it is running on.

This is the single definition.  Every service resolves its state directory
through it, so a change to the rule -- or to the sandbox rule below -- cannot
drift between the context budget, the usage ledger, and the installers that
write into the same tree.

Loaded with runpy rather than imported: the services are scripts, the bundled
copies live under a different root, and importing them would put their
directory on sys.path.
"""
import os
from pathlib import Path


def state_root(home=None):
    """The state directory for a given home.

    Resolution order reflects intent:

    1. ``PINKIE_STATE_ROOT`` wins outright.  The suites and portable runs point
       it at a scratch directory.
    2. Off Windows the macOS layout is used, because that is where the app and
       its installers have always kept state.
    3. An explicit home that is not the live profile means a sandbox: a test
       passing its own temporary root must not read or write the real user's
       state.  On Windows ``LOCALAPPDATA`` is always set, so consulting the
       environment before this would silently ignore the caller's home.
    4. Only the actual profile resolves through ``LOCALAPPDATA``, which is
       where the app keeps its state on Windows.
    """
    configured = os.environ.get('PINKIE_STATE_ROOT')
    if configured:
        return Path(configured)
    home = Path(home or Path.home())
    if os.name != 'nt':
        return home/'Library/Application Support/SuperPinkie'
    if home != Path.home():
        return home/'AppData/Local/SuperPinkie'
    return Path(os.environ.get('LOCALAPPDATA', home/'AppData/Local'))/'SuperPinkie'
