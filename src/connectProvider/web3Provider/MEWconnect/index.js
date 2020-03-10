import MEWconnect from '../../../index';
import networks from '../networks/index';
import { Transaction } from 'ethereumjs-tx';
import WalletInterface from '../WalletInterface';
import { MEW_CONNECT as mewConnectType } from '../bip44/index';
import {
  getSignTransactionObject,
  sanitizeHex,
  getBufferFromHex,
  calculateChainIdFromV
} from '../utils';
import { hashPersonalMessage } from 'ethereumjs-util';
import errorHandler from './errorHandler';
import commonGenerator from '../helpers/commonGenerator';
import Misc from '../helpers/misc';

const V1_SIGNAL_URL = 'https://connect.mewapi.io';
const V2_SIGNAL_URL = 'wss://connect2.mewapi.io/staging';
const IS_HARDWARE = true;

// TODO: add listener and ui notification on RtcConnectedEvent and RtcClosedEvent
class MEWconnectWalletInterface extends WalletInterface {
  constructor(pubkey, isHardware, identifier, txSigner, msgSigner, mewConnect) {
    super(pubkey, true, identifier);
    this.errorHandler = errorHandler;
    this.txSigner = txSigner;
    this.msgSigner = msgSigner;
    this.isHardware = isHardware;
    this.mewConnect = mewConnect();
  }

  getConnection() {
    return this.mewConnect;
  }

  signTransaction(txParams) {
    return super.signTransaction(txParams, this.txSigner);
  }

  signMessage(msg) {
    return super.signMessage(msg, this.msgSigner);
  }
}

class MEWconnectWallet {
  constructor(state) {
    this.identifier = mewConnectType;
    this.isHardware = IS_HARDWARE;
    this.mewConnect = new MEWconnect.Initiator({
      v1Url: V1_SIGNAL_URL,
      v2Url: V2_SIGNAL_URL,
      showPopup: true
    });
    // this.popupCreator = this.mewConnect.popupCreator;
    this.state = state || {};
  }

  static setConnectionState(connectionState) {
    if (!connectionState) MEWconnect.Initiator.connectionState = 'disconnected';
    else MEWconnect.Initiator.connectionState = connectionState;
  }

  static getConnectionState() {
    if (!MEWconnect.Initiator.connectionState) return 'disconnected';
    return MEWconnect.Initiator.connectionState;
  }

  async init(qrcodeListener = () => {}) {
    this.mewConnect.on('codeDisplay', qrcodeListener);
    const txSigner = async tx => {
      let tokenInfo;
      if (tx.data.slice(0, 10) === '0xa9059cbb') {
        tokenInfo = this.state.network.type.tokens.find(
          entry => entry.address.toLowerCase() === tx.to.toLowerCase()
        );
        if (tokenInfo) {
          tx.currency = {
            symbol: tokenInfo.symbol,
            decimals: tokenInfo.decimals,
            address: tokenInfo.address
          };
        }
      }
      const networkId = tx.chainId;
      return new Promise(resolve => {
        if (!tx.gasLimit) {
          tx.gasLimit = tx.gas;
        }
        this.mewConnect.sendRtcMessage('signTx', JSON.stringify(tx));
        this.mewConnect.once('signTx', result => {
          tx = new Transaction(sanitizeHex(result), {
            common: commonGenerator(this.state.network.type)
          });
          const signedChainId = calculateChainIdFromV(tx.v);
          if (signedChainId !== networkId)
            throw new Error(
              'Invalid networkId signature returned. Expected: ' +
              networkId +
              ', Got: ' +
              signedChainId,
              'InvalidNetworkId'
            );
          resolve(getSignTransactionObject(tx));
        });
      });
    };
    const msgSigner = async msg => {
      return new Promise(resolve => {
        const msgHash = hashPersonalMessage(Misc.toBuffer(msg));
        this.mewConnect.sendRtcMessage('signMessage', {
          hash: msgHash.toString('hex'),
          text: msg
        });
        this.mewConnect.once('signMessage', data => {
          resolve(getBufferFromHex(sanitizeHex(data.sig)));
        });
      });
    };

    const mewConnect = () => {
      return this.mewConnect;
    };

    const address = await signalerConnect(V1_SIGNAL_URL, this.mewConnect);

    return new MEWconnectWalletInterface(
      sanitizeHex(address),
      this.isHardware,
      this.identifier,
      txSigner,
      msgSigner,
      mewConnect // <- using this.mewConnect here was causing a circular reference and data clone error
    );
  }
}

const createWallet = async state => {
  const _MEWconnectWallet = new MEWconnectWallet(state);
  createWallet.connectionState = _MEWconnectWallet.connectionState;
  const _tWallet = await _MEWconnectWallet.init();
  return _tWallet;
};
createWallet.errorHandler = errorHandler;
const signalerConnect = (url, mewConnect) => {
  return new Promise((resolve, reject) => {
    mewConnect.initiatorStart(url);
    // mewConnect.on('AuthRejected', () => {
    //   reject();
    // });
    mewConnect.on('RtcConnectedEvent', () => {
      mewConnect.sendRtcMessage('address', '');
      mewConnect.once('address', data => {
        resolve(data.address);
      });
    });
  });
};

createWallet.getConnectionState = MEWconnectWallet.getConnectionState;
createWallet.setConnectionState = MEWconnectWallet.setConnectionState;

export default createWallet;
