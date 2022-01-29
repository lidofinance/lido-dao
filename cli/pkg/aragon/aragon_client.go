package aragon

import (
	"bytes"
	"errors"
	"fmt"
	"lido-aragon/pkg/deploy"
	"lido-aragon/pkg/logs"
	"os"
	"os/exec"
	"regexp"
	"strings"
	"syscall"
	"time"

	"github.com/pterm/pterm"
)

var (
	CMD_LOCAL   AragonNetwork = "local"
	CMD_MAINNET AragonNetwork = "mainnet"
	CMD_RINKEBY AragonNetwork = "rinkeby"
	CMD_STAGING AragonNetwork = "staging"
	CMD_ROPSTEN AragonNetwork = "ropsten"
	CMD_XDAI    AragonNetwork = "xdai"
)

type AragonNetwork string

type AragonClient struct {
	Cmd  *exec.Cmd
	Outb bytes.Buffer
	Errb bytes.Buffer

	RunningUrl  string
	EnsRegistry string
}

func checkApp(name string, address string, appInfo deploy.AppInfo, appLocatorArr *[]string) {
	if name == "" || address == "" {
		return
	}

	var appId string
	var appAddress string

	//check name
	if strings.HasPrefix(name, "0x") && name == appInfo.ID {
		appId = name
	} else if appInfo.ID != "" && name == appInfo.Name {
		appId = appInfo.ID
	} else {
		return
	}

	//check address
	if strings.Contains(address, "http://") || strings.Contains(address, "https://") {
		appAddress = address + "/"

		//check fo IPFS CID v0 - https://docs.ipfs.io/concepts/content-addressing/#identifier-formats
	} else if strings.HasPrefix(address, "Qm") && len(address) == 46 {
		//@todo load from flags
		appAddress = fmt.Sprintf("https://mainnet.lido.fi/ipfs/%s/", address)
	}

	*appLocatorArr = append(*appLocatorArr, fmt.Sprintf("%s:%s", appId, appAddress))
}

func getAppsLocator(lidoApps string, deployedFile *deploy.DeployedFile) []string {
	if lidoApps == "" {
		return nil
	}
	var appLocatorArr []string

	lidoAppsArray := strings.Split(lidoApps, ",")

	for _, app := range lidoAppsArray {
		tmp := strings.SplitN(app, ":", 2)

		checkApp(tmp[0], tmp[1], deployedFile.AppLido, &appLocatorArr)
		checkApp(tmp[0], tmp[1], deployedFile.AppOracle, &appLocatorArr)
		checkApp(tmp[0], tmp[1], deployedFile.AppNodeOperatorsRegistry, &appLocatorArr)
	}

	return appLocatorArr
}

func (node *AragonClient) Start(network AragonNetwork, lidoApps string, deployedFile *deploy.DeployedFile) error {
	s, _ := pterm.DefaultSpinner.Start("Aragon client: starting...")
	defer s.Stop()

	if network == CMD_MAINNET {
		os.Setenv("RUN_CMD", "mainnet")
	}

	appLocatorArr := getAppsLocator(lidoApps, deployedFile)

	if len(appLocatorArr) != 0 {
		os.Setenv("ARAGON_APP_LOCATOR", strings.Join(appLocatorArr, ","))
	}

	node.RunningUrl = ""
	node.Outb.Reset()
	node.Errb.Reset()

	node.Cmd = exec.Command("yarn", "aragon:start")
	// node.Cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	node.Cmd.Stdout = &node.Outb
	node.Cmd.Stderr = &node.Errb
	err := node.Cmd.Start()
	if err != nil {
		return err
	}

	re, _ := regexp.Compile(`Server running at (.*?)\s`)
	reEns, _ := regexp.Compile(`ARAGON_ENS_REGISTRY_ADDRESS=(.*?)`)

	for {
		if logs.Verbose {
			fmt.Print(node.Outb.String())
		}

		if strings.Contains(node.Outb.String(), "Built in") {
			s.Success()

			res := re.FindAllStringSubmatch(node.Outb.String(), -1)
			node.RunningUrl = string(res[0][1])

			res2 := reEns.FindAllStringSubmatch(node.Outb.String(), -1)
			node.EnsRegistry = string(res2[0][1])

			return nil
		}

		if strings.Contains(node.Errb.String(), "Error:") {
			s.Fail()
			pterm.Error.Println(node.Errb.String())
			return errors.New(node.Errb.String())
		}
		node.Outb.Reset()
		time.Sleep(1 * time.Second)
	}

	return nil
}

func (node *AragonClient) Stop() {
	if node.Cmd == nil {
		return
	}

	s, _ := pterm.DefaultSpinner.Start("Aragon client: Stopping...")
	syscall.Kill(-node.Cmd.Process.Pid, syscall.SIGKILL)
	node.Cmd.Process.Kill()
	node.Cmd = nil

	s.Success("Aragon client: Stopped")
}
