package cmd

import (
	"encoding/json"
	"fmt"
	"io/ioutil"
	"lido-aragon/pkg/aragon"
	"lido-aragon/pkg/daemon"
	"lido-aragon/pkg/deploy"
	"log"
	"os"

	"github.com/pterm/pterm"
	"github.com/spf13/cobra"
	"github.com/ttacon/chalk"
)

func init() {
	rootCmd.AddCommand(startCmd)
	rootCmd.AddCommand(startAragon)
	rootCmd.AddCommand(startNode)

	startCmd.AddCommand(startAllCmd)
	startCmd.AddCommand(startForkCmd)
}

var startAragon = &cobra.Command{
	Use:   "aragon",
	Short: "Start aragon client only",
	Run: func(cmd *cobra.Command, args []string) {
		os.Setenv("NETWORK_NAME", Lido.NetworkName)

		var aragonCmd aragon.AragonNetwork

		if Lido.NetworkName == "mainnet" {
			aragonCmd = aragon.CMD_MAINNET
		}

		pterm.Info.Printf("Network: %s\n", Lido.NetworkName)

		Lido.Deploy.DeployedFile, _, _ = getDeployedFile(Lido.NetworkName)

		err := Lido.AragonClient.Start(aragonCmd, Lido.LidoApps.AppsLocator, Lido.Deploy.DeployedFile)
		if err != nil {
			return
		}

		pterm.Println()
		pterm.FgWhite.Println("ARAGON_ENS_REGISTRY_ADDRESS = " + Lido.AragonClient.EnsRegistry)
		pterm.FgWhite.Println("Start aragon at: ", chalk.Yellow, Lido.AragonClient.RunningUrl+"/#/"+Lido.Deploy.DeployedFile.DaoAddress)

		daemon.WaitCtrlC()
	},
}

var startCmd = &cobra.Command{
	Use:   "start",
	Short: "Start local or form env",
}

func removeDeployedFile(deployedPath string) {
	if deployedPath == "" {
		return
	}

	if Lido.NetworkName == "mainnet" || Lido.NetworkName == "goerli" || Lido.NetworkName == "rinkeby" || Lido.NetworkName == "mainnet-test" {
		fmt.Printf("Can't remove deployed file on network %s\n", Lido.NetworkName)
	}

	e := os.Remove(deployedPath)
	if e != nil {
		log.Panic(e)
	}

	fmt.Printf("removed %s\n", deployedPath)
}

var startAllCmd = &cobra.Command{
	Use:   "all",
	Short: "Start hardhat node, start ipfs, deploy contracts, start lido apps, start aragon",
	Run: func(cmd *cobra.Command, args []string) {

		os.Setenv("NETWORK_NAME", Lido.NetworkName)

		var deployedPath string
		Lido.Deploy.DeployedFile, deployedPath, _ = getDeployedFile(Lido.NetworkName)

		removeDeployedFile(deployedPath)

		Lido.Contracts.Start()
		Lido.HardhatNode.Start("")
		Lido.IPFS.Start()
		if err := Lido.Deploy.Start(); err != nil {
			log.Println(err)
			return
		}
		if err := Lido.LidoApps.Start(); err != nil {
			log.Println(err)
			return
		}
		if err := Lido.AragonClient.Start("", Lido.LidoApps.AppsLocator, nil); err != nil {
			log.Println(err)
			return
		}

		if Lido.AragonClient.RunningUrl != "" && Lido.Deploy.DeployedFile.DaoAddress != "" {
			pterm.Println()
			pterm.FgYellow.Println("Start aragon at: " + Lido.AragonClient.RunningUrl + "/#/" + Lido.Deploy.DeployedFile.DaoAddress)
		}

		daemon.WaitCtrlC()
	},
}

var startForkCmd = &cobra.Command{
	Use:   "fork",
	Short: "Deploy API artifacts",
	Run: func(cmd *cobra.Command, args []string) {

		os.Setenv("NETWORK_NAME", Lido.NetworkName)

		fork, err := cmd.Flags().GetString("fork")
		if err != nil {
			return
		}

		if fork == "" {
			pterm.Error.Println("Please set --fork url")
			return
		}

		Lido.HardhatNode.Start(fork)

		Lido.Deploy.DeployedFile, _, _ = getDeployedFile(Lido.NetworkName)

		err = Lido.AragonClient.Start(aragon.CMD_MAINNET, Lido.LidoApps.AppsLocator, Lido.Deploy.DeployedFile)
		if err != nil {
			return
		}

		pterm.Println()
		pterm.FgWhite.Println("Start aragon at: " + Lido.AragonClient.RunningUrl + "/#/" + Lido.Deploy.DeployedFile.DaoAddress)

		daemon.WaitCtrlC()
	},
}

func getDeployedFile(networkName string) (*deploy.DeployedFile, string, error) {

	paths := []string{"./", "../"}
	for _, path := range paths {
		deployedPath := path + fmt.Sprintf("deployed-%s.json", networkName)

		_, err := os.Stat(deployedPath)
		if err != nil {
			continue
		}

		jsonFile, err := os.Open(deployedPath)
		if err != nil {
			return nil, "", err
		}
		jsonResult, _ := ioutil.ReadAll(jsonFile)

		defer jsonFile.Close()

		var deployedFile deploy.DeployedFile
		json.Unmarshal(jsonResult, &deployedFile)

		return &deployedFile, deployedPath, nil
	}

	return nil, "", nil
}
