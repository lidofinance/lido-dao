default: help

PATCH         = applyHarness.patch
CONTRACTS_DIR = ../contracts
MUNGED_DIR    = ./munged
WithdrawalQueue_Origin = ../contracts/0.8.9/WithdrawalQueue.sol
AccessControlEnumerable_O = ../contracts/0.8.9/utils/access/AccessControlEnumerable.sol
AccessControl_O = ../contracts/0.8.9/utils/access/AccessControl.sol
UnstructuredStorage_O = ../contracts/0.8.9/lib/UnstructuredStorage.sol
PausableUntil_O = ../contracts/0.8.9/utils/PausableUntil.sol
Versioned_O = ../contracts/0.8.9/utils/Versioned.sol
WithdrawalQueueBase_Origin = ../contracts/0.8.9/WithdrawalQueueBase.sol
StakingRouter_Origin = ../contracts/0.8.9/StakingRouter.sol
BeaconChain_Origin = ../contracts/0.8.9/BeaconChainDepositor.sol
NodeOperatorsRegistry_Origin = ../contracts/0.4.24/nos/NodeOperatorsRegistry.sol
SigningKeys_Origin = ../contracts/0.4.24/lib/SigningKeys.sol
WithdrawalQueue_munged = ./munged/WithdrawalQueue.sol
WithdrawalQueueBase_munged = ./munged/WithdrawalQueueBase.sol
StakingRouter_munged = ./munged/StakingRouter.sol
BeaconChain_munged = ./munged/BeaconChainDepositor.sol
NodeOperatorsRegistry_munged = ./munged/NodeOperatorsRegistry.sol
SigningKeys_munged = ./munged/SigningKeys.sol


help:
	@echo "usage:"
	@echo "  make clean:  remove all generated files (those ignored by git)"
	@echo "  make $(MUNGED_DIR): create $(MUNGED_DIR) directory by applying the patch file to $(CONTRACTS_DIR)"
	@echo "  make record: record a new patch file capturing the differences between $(CONTRACTS_DIR) and $(MUNGED_DIR)"

munge:
	cp $(StakingRouter_Origin) $(MUNGED_DIR)
	cp $(BeaconChain_Origin) $(MUNGED_DIR)
	cp $(NodeOperatorsRegistry_Origin) $(MUNGED_DIR)
	cp $(SigningKeys_Origin) $(MUNGED_DIR)
	cp $(WithdrawalQueue_Origin) $(MUNGED_DIR)
	mkdir -p $(MUNGED_DIR)/utils/access/ && cp $(AccessControlEnumerable_O) $(MUNGED_DIR)/utils/access/
	cp $(AccessControl_O) $(MUNGED_DIR)/utils/access/
	mkdir -p $(MUNGED_DIR)/lib && cp $(UnstructuredStorage_O) $(MUNGED_DIR)/lib
	mkdir -p $(MUNGED_DIR)/utils && cp $(PausableUntil_O) $(MUNGED_DIR)/utils
	cp $(Versioned_O) $(MUNGED_DIR)/utils
	cp $(WithdrawalQueueBase_Origin) $(MUNGED_DIR)
	patch -d $(MUNGED_DIR) < $(PATCH)

record:
	diff -burN $(StakingRouter_Origin) $(StakingRouter_munged) | sed 's+\$(StakingRouter_Origin)/++g' | sed 's+$(StakingRouter_munged)++g' > $(PATCH)
	diff -burN $(BeaconChain_Origin) $(BeaconChain_munged) | sed 's+\$(BeaconChain_Origin)/++g' | sed 's+$(BeaconChain_munged)++g' >> $(PATCH)
	diff -burN $(NodeOperatorsRegistry_Origin) $(NodeOperatorsRegistry_munged) | sed 's+\$(NodeOperatorsRegistry_Origin)/++g' | sed 's+$(NodeOperatorsRegistry_munged)++g' >> $(PATCH)
	diff -burN $(SigningKeys_Origin) $(SigningKeys_munged) | sed 's+\$(SigningKeys_Origin)/++g' | sed 's+$(SigningKeys_munged)++g' >> $(PATCH)
	diff -burN $(CONTRACTS_DIR) $(MUNGED_DIR) | sed 's+\.\./$(CONTRACTS_DIR)/++g' | sed 's+$(MUNGED_DIR)/++g' > $(PATCH)

clean:
	git clean -fdX
	touch $(PATCH)