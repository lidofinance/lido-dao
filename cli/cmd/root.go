package cmd

import (
	"lido-cli/pkg/apps"
	"lido-cli/pkg/aragon"
	"lido-cli/pkg/contracts"
	"lido-cli/pkg/deploy"
	"lido-cli/pkg/hardhat"
	"lido-cli/pkg/ipfs"
	"lido-cli/pkg/logs"

	"github.com/spf13/cobra"
)

type LidoExecutor struct {
	HardhatNode  *hardhat.HardhatNode
	IPFS         *ipfs.IPFS
	Contracts    *contracts.Contracts
	Deploy       *deploy.Deploy
	AragonClient *aragon.AragonClient
	LidoApps     *apps.LidoAppsClient

	NetworkName string
}

var (
	Lido = &LidoExecutor{
		HardhatNode:  &hardhat.HardhatNode{},
		IPFS:         &ipfs.IPFS{},
		Contracts:    &contracts.Contracts{},
		Deploy:       &deploy.Deploy{},
		AragonClient: &aragon.AragonClient{},
		LidoApps:     &apps.LidoAppsClient{},
	}
)

func (ld *LidoExecutor) Shutdown() {
	ld.HardhatNode.Stop()
	ld.IPFS.Stop()
	ld.AragonClient.Stop()
	ld.LidoApps.Stop()
}

var (
	rootCmd = &cobra.Command{
		Use:   "lido-cli",
		Short: "lido-cli: lido tool to start aragon env",
	}
)

// Execute executes the root command.
func Execute() error {
	rootCmd.CompletionOptions.DisableDefaultCmd = true
	rootCmd.SetHelpCommand(&cobra.Command{Hidden: true})

	rootCmd.PersistentFlags().StringVar(&Lido.NetworkName, "network", "localhost", "Set deploy network name")
	rootCmd.PersistentFlags().BoolVarP(&logs.Verbose, "verbose", "v", false, "Verbose output all of services")
	rootCmd.PersistentFlags().StringVar(&Lido.LidoApps.AppsLocator, "apps", "", "Which source to load app frontend assets from")
	rootCmd.PersistentFlags().StringVar(&Lido.LidoApps.Path, "apps-path", "", "Lido apps path")
	rootCmd.PersistentFlags().StringVar(&Lido.HardhatNode.Fork, "fork", "", "Fork endpoint ttps://mainnet.infura.io/v3/{WEB3_INFURA_PROJECT_ID}")

	return rootCmd.Execute()
}
