/* DHC Blockly plugin registry.
 *
 * Registers custom mutators for blocks whose I/O contract is variable-arity.
 * Loaded by blockly/preview.html (and, eventually, the SmartHome Designer's
 * Blockly bootstrap) BEFORE Blockly.defineBlocksWithJsonArray runs against
 * dhc-spatial-blocks.json — so the block JSON can reference these mutator
 * names by string.
 *
 * The serialization shape on every mutator is `extraState: { itemCount: N }`
 * to match the text_join / lists_create_with convention, so a workspace
 * round-trip looks exactly like the built-in dynamic blocks.
 *
 * Currently registered:
 *   - dhc_digital_home_mutator   ← used by dhc:DigitalHome
 *
 * Add a new variable-arity block by following the same three pieces:
 *   1. an item-count mixin (saveExtraState / loadExtraState / updateShape_)
 *   2. a one-line initializer (helper) that calls updateShape_ on construction
 *   3. two helper blocks (container + item) for the gear-icon UI
 *   4. Blockly.Extensions.registerMutator(name, mixin, helper, [helpers])
 */

(function () {
  if (typeof Blockly === 'undefined') {
    console.error('[dhc/registerPlugins] Blockly must load before this script');
    return;
  }

  // ── Helper blocks for the dhc:DigitalHome mutator UI ─────────────────────
  // These show up only inside the mutator popup (gear icon on the parent).
  Blockly.Blocks['dhc_digital_home_container'] = {
    init: function () {
      this.appendDummyInput().appendField('digital home');
      this.appendStatementInput('STACK');
      this.setColour(230);
      this.setTooltip('Add or remove "place" slots on this DigitalHome.');
      this.contextMenu = false;
    },
  };

  Blockly.Blocks['dhc_digital_home_item'] = {
    init: function () {
      this.appendDummyInput().appendField('place');
      this.setPreviousStatement(true);
      this.setNextStatement(true);
      this.setColour(230);
      this.setTooltip('One slot for a building or outdoor area.');
      this.contextMenu = false;
    },
  };

  // ── Mutator mixin ────────────────────────────────────────────────────────
  const DHC_DIGITAL_HOME_MIXIN = {
    itemCount_: 1,

    /** JSON serialization — what lands in the workspace.json file. */
    saveExtraState: function () {
      return { itemCount: this.itemCount_ };
    },

    /** Inverse — runs when a workspace is loaded. */
    loadExtraState: function (state) {
      this.updateShape_(state.itemCount || 1);
    },

    /** Build the mutator popup (gear icon) — one container with N items. */
    decompose: function (workspace) {
      const containerBlock = workspace.newBlock('dhc_digital_home_container');
      containerBlock.initSvg();
      let connection = containerBlock.getInput('STACK').connection;
      for (let i = 0; i < this.itemCount_; i++) {
        const itemBlock = workspace.newBlock('dhc_digital_home_item');
        itemBlock.initSvg();
        connection.connect(itemBlock.previousConnection);
        connection = itemBlock.nextConnection;
      }
      return containerBlock;
    },

    /** Apply the popup back to the parent block — called on close. */
    compose: function (containerBlock) {
      let itemBlock = containerBlock.getInputTargetBlock('STACK');
      const connections = [];
      while (itemBlock && !itemBlock.isInsertionMarker()) {
        connections.push(itemBlock.valueConnection_);
        itemBlock = itemBlock.getNextBlock();
      }
      // Disconnect children whose slots are about to be removed.
      for (let i = 0; i < this.itemCount_; i++) {
        const conn = this.getInput('hasPart_' + i)?.connection.targetConnection;
        if (conn && connections.indexOf(conn) === -1) conn.disconnect();
      }
      this.itemCount_ = connections.length;
      this.updateShape_(this.itemCount_);
      // Reconnect surviving children to their (possibly renumbered) slots.
      for (let i = 0; i < this.itemCount_; i++) {
        if (connections[i]) {
          const slot = this.getInput('hasPart_' + i);
          if (slot) slot.connection.connect(connections[i]);
        }
      }
    },

    /** Stash each child connection on its corresponding popup item so
     *  compose() can re-link them after the user clicks OK. */
    saveConnections: function (containerBlock) {
      let itemBlock = containerBlock.getInputTargetBlock('STACK');
      let i = 0;
      while (itemBlock) {
        const input = this.getInput('hasPart_' + i);
        itemBlock.valueConnection_ = input ? input.connection.targetConnection : null;
        i++;
        itemBlock = itemBlock.getNextBlock();
      }
    },

    /** Add/remove `hasPart_N` statement inputs to match `count`. */
    updateShape_: function (count) {
      // Remove all existing hasPart_* inputs first (cheaper than diffing)
      let i = 0;
      while (this.getInput('hasPart_' + i)) {
        this.removeInput('hasPart_' + i);
        i++;
      }
      // Add fresh slots
      for (i = 0; i < count; i++) {
        const slot = this.appendStatementInput('hasPart_' + i)
          .setCheck('rec:Architecture');
        slot.appendField(i === 0 ? 'places' : '');
      }
      this.itemCount_ = count;
    },
  };

  /** Initializer — runs once per block instance, after the block JSON is
   *  applied. We call updateShape_ so a freshly-dragged block has its
   *  default itemCount slots visible. */
  function DHC_DIGITAL_HOME_HELPER() {
    this.updateShape_(this.itemCount_);
  }

  Blockly.Extensions.registerMutator(
    'dhc_digital_home_mutator',
    DHC_DIGITAL_HOME_MIXIN,
    DHC_DIGITAL_HOME_HELPER,
    ['dhc_digital_home_container', 'dhc_digital_home_item']
  );

  console.info('[dhc/registerPlugins] dhc_digital_home_mutator registered');
})();
