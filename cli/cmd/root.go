package cmd

import (
	"fmt"
	"lido-aragon/pkg/apps"
	"lido-aragon/pkg/aragon"
	"lido-aragon/pkg/contracts"
	"lido-aragon/pkg/deploy"
	"lido-aragon/pkg/hardhat"
	"lido-aragon/pkg/ipfs"
	"lido-aragon/pkg/logs"

	"github.com/spf13/cobra"
)

var (
	version  string
	revision string
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
		Use:   "lido-aragon",
		Short: "lido-aragon: lido tool to start aragon env",
	}
)

// Execute executes the root command.
func Execute() error {
	rootCmd.CompletionOptions.DisableDefaultCmd = true
	rootCmd.Version = fmt.Sprintf("%s (rev-%s)\n", version, revision)
	rootCmd.SetHelpCommand(&cobra.Command{Hidden: true})

	rootCmd.PersistentFlags().StringVar(&Lido.NetworkName, "network", "localhost", "Set deploy network name")
	rootCmd.PersistentFlags().BoolVarP(&logs.Verbose, "verbose", "v", false, "Verbose output all of services")
	rootCmd.PersistentFlags().StringVar(&Lido.LidoApps.AppsLocator, "apps", "", "Which source to load app frontend assets from")
	rootCmd.PersistentFlags().StringVar(&Lido.LidoApps.Path, "apps-path", "", "Lido apps path")
	rootCmd.PersistentFlags().StringVar(&Lido.HardhatNode.Fork, "fork", "", "Fork endpoint https://mainnet.infura.io/v3/{WEB3_INFURA_PROJECT_ID}")
	rootCmd.PersistentFlags().IntVar(&Lido.IPFS.Timeout, "ipfs-timeout", 30, "IPFS daemon timeout")

	return rootCmd.Execute()
}
